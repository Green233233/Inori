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

from app import VERSION, admin, security  # noqa: E402
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

    def test_app_update_is_public(self) -> None:
        """检查更新不需要登录：冷启动时还没 token 也要能拿到版本。"""
        client = Client(self.base)
        payload = client.call("GET", "/api/v1/app/update")
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["version"], VERSION)
        self.assertIsInstance(payload["versionCode"], int)
        self.assertGreater(payload["versionCode"], 0)
        self.assertTrue(payload["notes"].strip())
        self.assertTrue(payload["downloadUrl"].startswith("https://"))
        self.assertIsInstance(payload["force"], bool)

    def test_update_download_url_env_override(self) -> None:
        """网盘直链可以只靠环境变量切换，坏值要退回默认地址。"""
        import importlib
        import os

        from app import update as update_mod

        original = os.environ.get("INORINAL_APP_DOWNLOAD_URL")
        try:
            os.environ["INORINAL_APP_DOWNLOAD_URL"] = "https://pan.example.com/s/abc"
            reloaded = importlib.reload(update_mod)
            self.assertEqual(reloaded.DOWNLOAD_URL, "https://pan.example.com/s/abc")
            self.assertEqual(
                reloaded.payload()["downloadUrl"], "https://pan.example.com/s/abc"
            )

            os.environ["INORINAL_APP_DOWNLOAD_URL"] = "javascript:alert(1)"
            reloaded = importlib.reload(update_mod)
            self.assertEqual(reloaded.DOWNLOAD_URL, reloaded.DEFAULT_DOWNLOAD_URL)
        finally:
            if original is None:
                os.environ.pop("INORINAL_APP_DOWNLOAD_URL", None)
            else:
                os.environ["INORINAL_APP_DOWNLOAD_URL"] = original
            importlib.reload(update_mod)

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

    def test_device_can_switch_account_when_pubkey_matches(self) -> None:
        """同一台手机换账号：公钥一致就允许把设备记录改绑到新账号。"""
        first, device_id = self._master("switcha")
        pubkey = "MASTER-PUBKEY-" + "A" * 40
        invite = self._new_invite()
        second = Client(self.base)
        payload = second.call("POST", "/api/v1/auth/register", {
            "username": "switchb", "password": "qi123456", "invite": invite,
            "deviceId": device_id, "deviceName": "主人机", "platform": "test",
            "pubkey": pubkey,
        })
        self.assertEqual(payload["username"], "switchb")
        second.token = payload["token"]
        self.assertEqual(second.call("GET", "/api/v1/auth/me")["username"], "switchb")

        # 公钥不一致时仍视为别的设备占用，拒绝。
        third = Client(self.base)
        taken = third.call("POST", "/api/v1/auth/login", {
            "username": "switcha", "password": "qi123456",
            "deviceId": device_id, "pubkey": "OTHER-PUBKEY-" + "C" * 40,
        }, expect=409)
        self.assertEqual(taken["error"]["code"], "device_taken")

    def test_register_rolls_back_user_when_device_conflicts(self) -> None:
        """设备被别的公钥占用时，注册要整体回滚，不能留下占名的孤儿账号。"""
        client, device_id = self._master("rollbacka")
        other = Client(self.base)
        invite = self._new_invite()
        other.call("POST", "/api/v1/auth/register", {
            "username": "rollbackb", "password": "qi123456", "invite": invite,
            "deviceId": device_id, "pubkey": "OTHER-PUBKEY-" + "D" * 40,
        }, expect=409)
        # 用户名没有被占住：换个 deviceId 就能用同一个名字注册成功。
        retry = Client(self.base)
        invite2 = self._new_invite()
        payload = retry.call("POST", "/api/v1/auth/register", {
            "username": "rollbackb", "password": "qi123456", "invite": invite2,
            "deviceId": "rollbackb-device-0002", "pubkey": "B" * 40,
        })
        self.assertEqual(payload["username"], "rollbackb")

    def test_pairing_and_sas(self) -> None:
        master, puppy, master_id, puppy_id = self._paired()
        state = puppy.call("GET", "/api/v1/pairs/current")["pair"]
        self.assertEqual(state["myRole"], "PUPPY")
        self.assertEqual(state["peerDeviceId"], master_id)
        self.assertTrue(state["verified"])
        second = puppy.call("POST", "/api/v1/pairs", {
            "ownerName": "再绑一次"}, expect=409)
        self.assertEqual(second["error"]["code"], "already_paired")
        # 提示必须说清「和谁绑过、下一步去哪」，而不是一句死路。
        message = second["error"]["message"]
        self.assertIn("我的身份与联结", message)
        self.assertIn("绑定好了", message)

    def test_join_twice_explains_unverified_state(self) -> None:
        """重复加入时要说清「已经绑过了、只是没校验」，而不是让用户无路可走。"""
        master, _ = self._master("jointwice")
        created = master.call("POST", "/api/v1/pairs", {"ownerName": "主人A"})
        code = created["bindingCode"]
        puppy = Client(self.base)
        invite = self._new_invite()
        registered = puppy.call("POST", "/api/v1/auth/register", {
            "username": "jointwicep", "password": "qi123456", "invite": invite,
            "deviceId": "jointwice-puppy-0001", "pubkey": "P" * 40,
        })
        puppy.token = registered["token"]
        joined = puppy.call("POST", "/api/v1/pairs/join", {
            "code": code, "puppyName": "小狗A"})
        self.assertFalse(joined["pair"]["verified"])
        again = puppy.call("POST", "/api/v1/pairs/join", {
            "code": code, "puppyName": "小狗A"}, expect=409)
        self.assertEqual(again["error"]["code"], "already_paired")
        message = again["error"]["message"]
        self.assertIn("主人A", message)
        self.assertIn("安全校验", message)

    def test_binding_code_rejected_as_invite(self) -> None:
        """绑定码和邀请码是同一套 8 位字母表，填错位置时要说清怎么走。

        光比格式分不出来，只能查 pairs.code_hash：拿一个还在有效期内的绑定码去注册，
        服务端要回 invite_is_pair_code，并提示「先登录，再到绑定页填写」。
        """
        master, _ = self._master("bindcode")
        created = master.call("POST", "/api/v1/pairs", {"ownerName": "主人B"})
        code = created["bindingCode"]
        client = Client(self.base)
        failure = client.call("POST", "/api/v1/auth/register", {
            "username": "bindcodeinvite", "password": "qi123456", "invite": code,
            "deviceId": "bindcode-device-0001", "pubkey": "C" * 40,
        }, expect=400)
        self.assertEqual(failure["error"]["code"], "invite_is_pair_code")
        message = failure["error"]["message"]
        self.assertIn("绑定码", message)
        self.assertIn("邀请码只用于创建新账号", message)

    def test_unpair_reports_already_unpaired(self) -> None:
        """解绑两次不该报错：第二次要回 alreadyUnpaired，界面才好说「对方先解了」。

        以前第二次直接 404，客户端又把它当失败，用户会以为没解开而反复点。
        """
        master, puppy, _, _ = self._paired()
        first = master.call("DELETE", "/api/v1/pairs", {})
        self.assertFalse(first.get("alreadyUnpaired", False))
        second = master.call("DELETE", "/api/v1/pairs", {})
        self.assertTrue(second["alreadyUnpaired"])
        # 小狗端也一样：解绑是幂等的，不区分谁先动手。
        third = puppy.call("DELETE", "/api/v1/pairs", {})
        self.assertTrue(third["alreadyUnpaired"])

    def test_session_expired_is_401(self) -> None:
        """token 失效必须是 401，客户端据此清会话回登录页。

        若服务端在这里回 403/404，客户端只会显示「请求失败」，人还停在主界面，
        每次操作都失败却看不出要重新登录。
        """
        inviter = Client(self.base)
        inviter.call("GET", "/api/v1/pairs/current", expect=401)
        master, _ = self._master("expired")
        master.token = "not-a-real-token"
        expired = master.call("GET", "/api/v1/pairs/current", expect=401)
        self.assertEqual(expired["error"]["code"], "unauthorized")
        write = master.call("POST", "/api/v1/relay/send", {
            "kind": "command.send", "ciphertext": "x"}, expect=401)
        self.assertEqual(write["error"]["code"], "unauthorized")

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
            "kind": "task", "ciphertext": "cipher-A", "revision": 1,
            "updatedAt": 1000})
        self.assertFalse(first["stale"])
        stale = puppy.call("PUT", "/api/v1/sync/records/record_aaaaaaaa01", {
            "kind": "task", "ciphertext": "cipher-old", "revision": 0,
            "updatedAt": 500})
        self.assertTrue(stale["stale"])
        newer = puppy.call("PUT", "/api/v1/sync/records/record_aaaaaaaa01", {
            "kind": "task", "ciphertext": "cipher-B", "revision": 2,
            "updatedAt": 2000})
        self.assertFalse(newer["stale"])

        # 日记是作者私有的：同一配对的另一方不能覆盖/删除。
        master.call("PUT", "/api/v1/sync/records/record_aaaaaaaa02", {
            "kind": "journal", "ciphertext": "cipher-J", "revision": 1,
            "updatedAt": 1000})
        puppy.call("PUT", "/api/v1/sync/records/record_aaaaaaaa02", {
            "kind": "journal", "ciphertext": "cipher-X", "revision": 2,
            "updatedAt": 2000}, expect=403)
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

    def test_staging_roundtrip_dedupe_and_ack(self) -> None:
        """状态是「发送端上传、接收端直接拉取」，同一 dedupeKey 只留最新一份。"""
        master, puppy, _, _ = self._paired()
        first = master.call("POST", "/api/v1/staging/send", {
            "kind": "status", "ciphertext": "cipher-old", "dedupeKey": "status"})
        self.assertTrue(first["ok"])
        second = master.call("POST", "/api/v1/staging/send", {
            "kind": "status", "ciphertext": "cipher-new", "dedupeKey": "status"})
        self.assertGreater(second["rev"], first["rev"])

        polled = puppy.call("GET", "/api/v1/staging/poll?cursor=0&wait=0")
        self.assertEqual(len(polled["items"]), 1)
        item = polled["items"][0]
        self.assertEqual(item["ciphertext"], "cipher-new")
        self.assertEqual(item["kind"], "status")
        self.assertGreater(polled["usedBytes"], 0)
        self.assertFalse(polled["pressure"])

        # 客户端用 sinceRev 游标：只应返回游标之后的新条目，不能反复重放旧条目。
        third = master.call("POST", "/api/v1/staging/send", {
            "kind": "profile", "ciphertext": "cipher-third", "dedupeKey": "profile"})
        after = puppy.call(
            "GET", f"/api/v1/staging/poll?sinceRev={item['rev']}&wait=0")
        self.assertEqual([entry["rev"] for entry in after["items"]], [third["rev"]])
        third_item = after["items"][0]

        acked = puppy.call("POST", "/api/v1/staging/ack", {"ids": [item["id"], third_item["id"]]})
        self.assertEqual(acked["deleted"], 2)
        again = puppy.call("GET", "/api/v1/staging/poll?cursor=0&wait=0")
        self.assertEqual(again["items"], [])
        self.assertEqual(again["usedBytes"], 0)

    def test_staging_rejects_unknown_kind(self) -> None:
        master, _, _, _ = self._paired()
        payload = master.call("POST", "/api/v1/staging/send", {
            "kind": "journal", "ciphertext": "cipher"}, expect=400)
        self.assertEqual(payload["error"]["code"], "invalid_kind")

    def test_staging_pair_limits_and_gates(self) -> None:
        """每对绑定可单独设置暂存时长、容量与两个门禁。"""
        master, puppy, master_id, _ = self._paired()
        path = os.path.join(self.tmp, "qi.sqlite3")
        db = Database(path)
        pair_id = db.conn.execute(
            "SELECT id FROM pairs WHERE master_device=? AND unpaired_at IS NULL",
            (master_id,)).fetchone()["id"]
        admin.set_pair_limits(db, pair_id, {
            "ttlHours": 1, "budgetBytes": 1048576,
            "timeGate": True, "sizeGate": False}, "test")
        db.conn.commit()
        quota = master.call("GET", "/api/v1/staging/quota")
        self.assertEqual(quota["ttlHours"], 1)
        self.assertEqual(quota["budgetBytes"], 1048576)
        self.assertTrue(quota["timeGate"])
        self.assertFalse(quota["sizeGate"])

        for kind in ("status", "profile", "location"):
            master.call("POST", "/api/v1/staging/send", {
                "kind": kind, "ciphertext": "x" * 400000, "dedupeKey": kind})
        over = master.call("GET", "/api/v1/staging/quota")
        self.assertGreater(over["usedBytes"], over["budgetBytes"])
        self.assertFalse(over["pressure"])

        admin.set_pair_limits(db, pair_id, {
            "budgetBytes": 1048576, "sizeGate": True}, "test")
        db.conn.commit()
        master.call("POST", "/api/v1/staging/send", {
            "kind": "trail", "ciphertext": "y" * 400000, "dedupeKey": "trail"})
        limited = master.call("GET", "/api/v1/staging/quota")
        self.assertLessEqual(limited["usedBytes"], 1048576)
        db.close()

    def test_staging_time_gate_off_extends_expiry(self) -> None:
        """关闭时间门禁时，未确认条目不会被旧 expires_at 卡住。"""
        master, puppy, master_id, _ = self._paired()
        master.call("POST", "/api/v1/staging/send", {
            "kind": "status", "ciphertext": "keep-me", "dedupeKey": "status"})
        path = os.path.join(self.tmp, "qi.sqlite3")
        db = Database(path)
        pair_id = db.conn.execute(
            "SELECT id FROM pairs WHERE master_device=? AND unpaired_at IS NULL",
            (master_id,)).fetchone()["id"]
        db.conn.execute(
            "UPDATE staged_items SET expires_at='2000-01-01T00:00:00Z' WHERE pair_id=?",
            (pair_id,))
        admin.set_pair_limits(db, pair_id, {"timeGate": False}, "test")
        db.conn.commit()
        row = db.conn.execute(
            "SELECT expires_at FROM staged_items WHERE pair_id=?", (pair_id,)).fetchone()
        self.assertGreater(row["expires_at"], security.iso())
        polled = puppy.call("GET", "/api/v1/staging/poll?cursor=0&wait=0")
        self.assertEqual([item["ciphertext"] for item in polled["items"]], ["keep-me"])
        db.close()

    def test_sync_self_audience_is_private(self) -> None:
        """私密日记只回作者自己的设备，对方拉不到。"""
        master, puppy, _, _ = self._paired()
        master.call("PUT", "/api/v1/sync/records/record_abcdefgh01", {
            "kind": "journal", "ciphertext": "self-cipher",
            "updatedAt": 1000, "audience": "self"})
        master.call("PUT", "/api/v1/sync/records/record_abcdefgh02", {
            "kind": "journal", "ciphertext": "pair-cipher", "updatedAt": 1000})
        mine = master.call("GET", "/api/v1/sync/records?sinceSeq=0")
        self.assertEqual(
            {item["recordId"] for item in mine["items"]},
            {"record_abcdefgh01", "record_abcdefgh02"})
        partner = puppy.call("GET", "/api/v1/sync/records?sinceSeq=0")
        self.assertEqual(
            [item["recordId"] for item in partner["items"]],
            ["record_abcdefgh02"])

    def test_cloud_quota_rejects_when_full(self) -> None:
        master, _, _, _ = self._paired()
        path = os.path.join(self.tmp, "qi.sqlite3")
        db = Database(path)
        db.conn.execute(
            "UPDATE pairs SET cloud_quota_bytes=1000 WHERE unpaired_at IS NULL")
        db.close()
        master.call("PUT", "/api/v1/sync/records/record_quota0001", {
            "kind": "journal", "ciphertext": "x" * 600, "updatedAt": 1000})
        payload = master.call("PUT", "/api/v1/sync/records/record_quota0002", {
            "kind": "journal", "ciphertext": "x" * 600, "updatedAt": 1000},
            expect=507)
        self.assertEqual(payload["error"]["code"], "cloud_full")

    def test_unauthorized(self) -> None:
        client = Client(self.base)
        payload = client.call("GET", "/api/v1/auth/me", expect=401)
        self.assertEqual(payload["error"]["code"], "unauthorized")


if __name__ == "__main__":
    unittest.main(verbosity=2)
