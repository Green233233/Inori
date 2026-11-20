#!/usr/bin/env python3
"""祈服务器端到端接口测试（真实起服务 + 临时数据目录）。

    python server/tests/test_api.py -v
"""

from __future__ import annotations

import base64
import json
import os
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request

SERVER_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, SERVER_DIR)

from app import VERSION, security  # noqa: E402
from app.store import Database  # noqa: E402


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


class Client:
    def __init__(self, base: str):
        self.base = base
        self.token: str | None = None

    def call(self, method: str, path: str, body=None, expect: int = 200):
        data = json.dumps(body).encode("utf-8") if body is not None else None
        request = urllib.request.Request(self.base + path, data=data, method=method)
        request.add_header("Content-Type", "application/json")
        if self.token:
            request.add_header("Authorization", "Bearer " + self.token)
        try:
            with urllib.request.urlopen(request, timeout=40) as response:
                payload = json.loads(response.read().decode("utf-8"))
                assert response.status == expect, (response.status, payload)
                return payload
        except urllib.error.HTTPError as error:
            payload = json.loads(error.read().decode("utf-8"))
            assert error.code == expect, (error.code, payload)
            return payload


class ApiTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.tmp = tempfile.mkdtemp(prefix="qi-test-")
        cls.invite_a = cls._new_invite()
        cls.invite_b = cls._new_invite()
        cls.port = free_port()
        cls.base = f"http://127.0.0.1:{cls.port}"
        env = dict(os.environ, QI_LOG_LEVEL="WARNING", QI_RATE_LIMIT_DISABLED="1")
        cls.proc = subprocess.Popen(
            [sys.executable, os.path.join(SERVER_DIR, "run.py"),
             "--host", "127.0.0.1", "--port", str(cls.port),
             "--data-dir", cls.tmp],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=env,
        )
        deadline = time.time() + 15
        while time.time() < deadline:
            try:
                with urllib.request.urlopen(cls.base + "/health", timeout=2) as response:
                    if response.status == 200:
                        break
            except Exception:
                time.sleep(0.15)
        else:
            raise RuntimeError("server did not start")

    @classmethod
    def _new_invite(cls) -> str:
        db = Database(os.path.join(cls.tmp, "qi.sqlite3"))
        code = security.random_pair_code()
        db.conn.execute("INSERT INTO invites(code, created_at) VALUES(?, ?)",
                        (code, security.iso()))
        db.close()
        return code

    @classmethod
    def tearDownClass(cls) -> None:
        cls.proc.terminate()
        try:
            cls.proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            cls.proc.kill()

    # -- helpers --------------------------------------------------------
    def _master(self, name: str | None = None) -> tuple[Client, str]:
        client = Client(self.base)
        invite = self._new_invite()
        name = name or ("m" + os.urandom(4).hex())
        payload = client.call("POST", "/api/v1/auth/register", {
            "username": name, "password": "qi123456",
            "invite": invite, "deviceId": f"master-{name}-0001",
            "deviceName": "主人机", "platform": "test",
            "pubkey": "MASTER-PUBKEY-" + "A" * 40,
        })
        client.token = payload["token"]
        return client, payload["deviceId"]

    def _puppy(self, name: str | None = None) -> tuple[Client, str]:
        client = Client(self.base)
        invite = self._new_invite()
        name = name or ("d" + os.urandom(4).hex())
        payload = client.call("POST", "/api/v1/auth/register", {
            "username": name, "password": "qi123456",
            "invite": invite, "deviceId": f"puppy-{name}-0001",
            "deviceName": "小狗机", "platform": "test",
            "pubkey": "PUPPY-PUBKEY-" + "B" * 40,
        })
        client.token = payload["token"]
        return client, payload["deviceId"]

    def _paired(self):
        master, master_id = self._master()
        puppy, puppy_id = self._puppy()
        created = master.call("POST", "/api/v1/pairs", {
            "ownerName": "主人", "puppyName": "小不点儿"})
        code = created["bindingCode"]
        joined = puppy.call("POST", "/api/v1/pairs/join",
                          {"code": code, "puppyName": "小不点儿"})
        self.assertTrue(joined["pair"]["peerPubkey"].startswith("MASTER-PUBKEY"))
        master.call("POST", "/api/v1/pairs/verify", {"sasFingerprint": "a" * 40})
        return master, puppy, master_id, puppy_id

    # -- tests ----------------------------------------------------------
    def test_health(self) -> None:
        client = Client(self.base)
        payload = client.call("GET", "/health")
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["version"], VERSION)

    def test_register_requires_invite_and_valid_password(self) -> None:
        client = Client(self.base)
        weak = client.call("POST", "/api/v1/auth/register", {
            "username": "weak", "password": "abcdefgh", "invite": "ZZZZZZZZ",
            "deviceId": "weak-device-0001", "pubkey": "W" * 40,
        }, expect=400)
        self.assertEqual(weak["error"]["code"], "weak_password")
        no_invite = client.call("POST", "/api/v1/auth/register", {
            "username": "noinv", "password": "qi123456", "invite": "ZZZZZZZZ",
            "deviceId": "noinv-device-0001", "pubkey": "N" * 40,
        }, expect=403)
        self.assertEqual(no_invite["error"]["code"], "invite_required")

    def test_open_registration_switch(self) -> None:
        """开放注册（INORINAL_OPEN_REGISTRATION=1）时不需要邀请码。

        开关在服务端进程启动时读取，所以要单独起一台服务器验证。
        """
        port = free_port()
        base = f"http://127.0.0.1:{port}"
        env = dict(os.environ, QI_LOG_LEVEL="WARNING",
                   QI_RATE_LIMIT_DISABLED="1", INORINAL_OPEN_REGISTRATION="1")
        proc = subprocess.Popen(
            [sys.executable, os.path.join(SERVER_DIR, "run.py"),
             "--host", "127.0.0.1", "--port", str(port),
             "--data-dir", tempfile.mkdtemp(prefix="qi-open-")],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=env,
        )
        try:
            deadline = time.time() + 15
            while time.time() < deadline:
                try:
                    with urllib.request.urlopen(base + "/health", timeout=2) as response:
                        if response.status == 200:
                            break
                except Exception:
                    time.sleep(0.15)
            else:
                raise RuntimeError("server did not start")

            client = Client(base)
            payload = client.call("POST", "/api/v1/auth/register", {
                "username": "openreg", "password": "qi123456", "invite": "",
                "deviceId": "openreg-device-0001", "pubkey": "O" * 40,
            })
            self.assertEqual(payload["username"], "openreg")
        finally:
            proc.terminate()
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proc.kill()

    def test_login_and_me(self) -> None:
        client, device_id = self._master("loginuser")
        fresh = Client(self.base)
        payload = fresh.call("POST", "/api/v1/auth/login", {
            "username": "loginuser", "password": "qi123456",
            "deviceId": device_id, "deviceName": "主人机", "platform": "test",
            "pubkey": "MASTER-PUBKEY-" + "A" * 40,
        })
        fresh.token = payload["token"]
        me = fresh.call("GET", "/api/v1/auth/me")
        self.assertEqual(me["username"], "loginuser")
        self.assertIsNone(me["pair"])
        bad = Client(self.base)
        bad.call("POST", "/api/v1/auth/login", {
            "username": "loginuser", "password": "wrong-pass1",
            "deviceId": device_id, "pubkey": "M" * 40,
        }, expect=401)
        client.call("GET", "/api/v1/auth/me", expect=200)

    def test_pairing_and_sas(self) -> None:
        master, puppy, master_id, puppy_id = self._paired()
        state = puppy.call("GET", "/api/v1/pairs/current")["pair"]
        self.assertEqual(state["myRole"], "PUPPY")
        self.assertEqual(state["peerDeviceId"], master_id)
        self.assertTrue(state["verified"])
        second = puppy.call("POST", "/api/v1/pairs", {
            "ownerName": "再绑一次"}, expect=409)
        self.assertEqual(second["error"]["code"], "already_paired")

    def test_relay_roundtrip_and_ack(self) -> None:
        master, puppy, master_id, _ = self._paired()
        ciphertext = "not-json-密文-✓\\n"
        sent = master.call("POST", "/api/v1/relay/send", {
            "kind": "command.send", "ciphertext": ciphertext})
        self.assertGreater(sent["seq"], 0)
        polled = puppy.call("GET", "/api/v1/relay/poll?cursor=0&wait=3")
        kinds = [item["kind"] for item in polled["items"]]
        self.assertIn("command.send", kinds)
        arrival = [item for item in polled["items"] if item["kind"] == "command.send"][0]
        self.assertEqual(arrival["ciphertext"], ciphertext)
        self.assertEqual(arrival["fromDevice"], master_id)
        puppy.call("POST", "/api/v1/relay/ack", {"seqs": [arrival["seq"]]})
        again = puppy.call("GET", f"/api/v1/relay/poll?cursor={arrival['seq']}&wait=1")
        self.assertEqual(again["items"], [])

    def test_relay_rejects_unknown_kind(self) -> None:
        master, puppy, _, _ = self._paired()
        bad = master.call("POST", "/api/v1/relay/send", {
            "kind": "evil.kind", "ciphertext": "x"}, expect=400)
        self.assertEqual(bad["error"]["code"], "invalid_kind")

    def test_long_poll_waits_then_returns(self) -> None:
        master, puppy, _, _ = self._paired()
        started = time.time()
        empty = puppy.call("GET", "/api/v1/relay/poll?cursor=0&wait=1")
        elapsed = time.time() - started
        self.assertEqual(empty["items"], [])
        self.assertGreaterEqual(elapsed, 0.8)
        self.assertLess(elapsed, 6)

    def test_sync_records_lww_and_cursor(self) -> None:
        master, puppy, master_id, puppy_id = self._paired()
        first = master.call("PUT", "/api/v1/sync/records/record_aaaaaaaa01", {
            "kind": "journal", "ciphertext": "cipher-A", "revision": 1,
            "updatedAt": 1000})
        self.assertFalse(first["stale"])
        stale = puppy.call("PUT", "/api/v1/sync/records/record_aaaaaaaa01", {
            "kind": "journal", "ciphertext": "cipher-old", "revision": 0,
            "updatedAt": 500})
        self.assertTrue(stale["stale"])
        newer = puppy.call("PUT", "/api/v1/sync/records/record_aaaaaaaa01", {
            "kind": "journal", "ciphertext": "cipher-B", "revision": 2,
            "updatedAt": 2000})
        self.assertFalse(newer["stale"])
        listed = master.call("GET", "/api/v1/sync/records?sinceSeq=0")
        record = [item for item in listed["items"]
                  if item["recordId"] == "record_aaaaaaaa01"][0]
        self.assertEqual(record["ciphertext"], "cipher-B")
        self.assertEqual(record["authorDevice"], puppy_id)
        tail = master.call(
            "GET", f"/api/v1/sync/records?sinceSeq={listed['cursor']}")
        self.assertEqual(tail["items"], [])

    def test_media_chunks(self) -> None:
        master, puppy, _, _ = self._paired()
        chunk = base64.b64encode(b"hello-qi").decode("ascii")
        master.call("PUT", "/api/v1/sync/media/media_aaaaaaaa01/0", {"data": chunk})
        fetched = puppy.call("GET", "/api/v1/sync/media/media_aaaaaaaa01/0")
        self.assertEqual(base64.b64decode(fetched["data"]), b"hello-qi")
        missing = puppy.call("GET", "/api/v1/sync/media/media_aaaaaaaa01/9")
        self.assertIsNone(missing["data"])

    def test_coupons_flow(self) -> None:
        master, puppy, _, puppy_id = self._paired()
        generated = master.call("POST", "/api/v1/coupons", {
            "type": "hehao", "count": 2, "noteCipher": "enc-note"})
        self.assertEqual(len(generated["coupons"]), 2)
        coupon = generated["coupons"][0]
        self.assertIn("·", coupon["code"])
        self.assertEqual(len(coupon["normalizedCode"]), 14)

        wallet = puppy.call("GET", "/api/v1/coupons?status=unused")
        self.assertEqual(wallet["total"], 2)

        checked = puppy.call("POST", "/api/v1/coupons/verify",
                           {"code": coupon["code"].lower().replace("·", "-")})
        self.assertTrue(checked["signatureValid"])
        self.assertEqual(checked["status"], "unused")

        redeemed = puppy.call("POST", "/api/v1/coupons/redeem",
                            {"code": coupon["code"], "noteCipher": "used-note"})
        self.assertEqual(redeemed["coupon"]["status"], "used")
        self.assertEqual(redeemed["coupon"]["usedByDevice"], puppy_id)
        repeated = puppy.call("POST", "/api/v1/coupons/redeem",
                            {"code": coupon["code"]}, expect=409)
        self.assertEqual(repeated["error"]["code"], "already_used")
        forged = puppy.call("POST", "/api/v1/coupons/redeem",
                          {"code": "AAAAAAA-9999999"}, expect=404)
        self.assertEqual(forged["error"]["code"], "not_found")
        master_only = puppy.call("POST", "/api/v1/coupons",
                               {"type": "hehao", "count": 1}, expect=403)
        self.assertEqual(master_only["error"]["code"], "master_only")
        keyinfo = master.call("GET", "/api/v1/coupons/keyinfo")
        self.assertEqual(keyinfo["algorithm"], "Ed25519")
        self.assertIn("BEGIN PUBLIC KEY", keyinfo["publicKeyPem"])

    def test_reward_coupon_reverse_flow(self) -> None:
        """奖励券反向派发：小狗签发、主人领取并填写奖励内容。"""
        master, puppy, _, _ = self._paired()
        reward = puppy.call("POST", "/api/v1/coupons",
                            {"type": "reward", "count": 1})["coupons"][0]
        self.assertEqual(reward["type"], "reward")
        self.assertEqual(reward["typeLabel"], "奖励券")

        puppy_is_not_issuer = master.call(
            "POST", "/api/v1/coupons", {"type": "reward", "count": 1}, expect=403
        )
        self.assertEqual(puppy_is_not_issuer["error"]["code"], "puppy_only")

        master_is_not_redeemer = puppy.call(
            "POST", "/api/v1/coupons/redeem", {"code": reward["code"]}, expect=403
        )
        self.assertEqual(master_is_not_redeemer["error"]["code"], "master_only")

        redeemed = master.call("POST", "/api/v1/coupons/redeem", {
            "code": reward["code"], "noteCipher": "reward-note"})
        self.assertEqual(redeemed["coupon"]["status"], "used")
        self.assertEqual(redeemed["coupon"]["usedNoteCipher"], "reward-note")

    def test_issuer_can_mark_coupon_used_offline(self) -> None:
        """签发方可以声明「已经在线下核销」，非签发方不行。"""
        master, puppy, _, _ = self._paired()
        coupon = master.call("POST", "/api/v1/coupons",
                             {"type": "hehao", "count": 1})["coupons"][0]
        # 小狗端不是签发方，不能替主人把券标成线下已用。
        denied = puppy.call(
            "POST", "/api/v1/coupons/redeem",
            {"code": coupon["code"], "offline": True}, expect=403,
        )
        self.assertEqual(denied["error"]["code"], "issuer_only")
        used = master.call("POST", "/api/v1/coupons/redeem",
                           {"code": coupon["code"], "offline": True})
        self.assertEqual(used["coupon"]["status"], "used")
        again = master.call("POST", "/api/v1/coupons/redeem",
                            {"code": coupon["code"], "offline": True}, expect=409)
        self.assertEqual(again["error"]["code"], "already_used")

    def test_coupon_single_use_under_concurrency(self) -> None:
        master, puppy, _, _ = self._paired()
        coupon = master.call("POST", "/api/v1/coupons",
                             {"type": "exam", "count": 1})["coupons"][0]
        outcomes: list[int] = []
        lock = threading.Lock()

        def attempt() -> None:
            client = Client(self.base)
            client.token = puppy.token
            try:
                client.call("POST", "/api/v1/coupons/redeem",
                            {"code": coupon["code"]})
                with lock:
                    outcomes.append(200)
            except AssertionError:
                with lock:
                    outcomes.append(409)

        threads = [threading.Thread(target=attempt) for _ in range(20)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        self.assertEqual(outcomes.count(200), 1)
        self.assertEqual(outcomes.count(409), 19)

    def test_presence(self) -> None:
        master, puppy, master_id, puppy_id = self._paired()
        master.call("POST", "/api/v1/presence",
                    {"battery": 73, "charging": True, "payload": "cipher"})
        seen = puppy.call("GET", f"/api/v1/presence/{master_id}")
        self.assertIsNotNone(seen["presence"])
        self.assertEqual(seen["presence"]["battery"], 73)
        self.assertTrue(seen["presence"]["online"])

    def test_unpair_removes_ciphertext(self) -> None:
        master, puppy, _, _ = self._paired()
        master.call("PUT", "/api/v1/sync/records/record_bbbbbbbb02", {
            "kind": "journal", "ciphertext": "cipher", "updatedAt": 1000})
        master.call("DELETE", "/api/v1/pairs", {"payload": "bye"})
        self.assertIsNone(master.call("GET", "/api/v1/pairs/current")["pair"])
        puppy_state = puppy.call("GET", "/api/v1/pairs/current")["pair"]
        self.assertIsNone(puppy_state)
        after = master.call("GET", "/api/v1/sync/records?sinceSeq=0", expect=403)
        self.assertEqual(after["error"]["code"], "no_pair")

    def test_unauthorized(self) -> None:
        client = Client(self.base)
        payload = client.call("GET", "/api/v1/auth/me", expect=401)
        self.assertEqual(payload["error"]["code"], "unauthorized")


if __name__ == "__main__":
    unittest.main(verbosity=2)
