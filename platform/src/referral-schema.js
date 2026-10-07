import {z} from 'zod';
// No service/payment imports: invokeSchema needs this during module evaluation.
export const referralCodeSchema=z.string().regex(/^ref_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/).describe('Public referral code returned by registration. First-party tools only; preserve it in the original invoke body on every replay.');
