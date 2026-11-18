/**
 * 和好券页面入口：给 App / MainTabs 集成用。
 * 每个屏幕都有 default 导出；这里再聚合成命名导出，便于一行引入。
 */
export {default as Ticket} from './Ticket';
export type {TicketProps} from './Ticket';

export {default as CouponManagement} from './CouponManagement';
export type {CouponManagementProps} from './CouponManagement';

export {default as CouponWallet} from './CouponWallet';
export type {CouponWalletProps} from './CouponWallet';

export {default as CouponDetail} from './CouponDetail';
export type {CouponDetailProps} from './CouponDetail';

export {default as CouponRedeem} from './CouponRedeem';
export type {CouponRedeemProps} from './CouponRedeem';
