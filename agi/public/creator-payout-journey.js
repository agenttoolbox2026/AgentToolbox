import {bindCreatorWallet} from './creator-wallet.js';
import {bindWalletProof} from './wallet-proof.js';
import {bindCreatorEarnings} from './creator-earnings.js';
import {bindPayoutRequests} from './payout-requests.js';

const capabilityInput=document.querySelector('#creator-wallet-capability');
if(capabilityInput){
 const wallet=document.querySelector('[data-creator-wallet]');
 if(wallet)bindCreatorWallet(wallet);
 const proof=document.querySelector('[data-wallet-proof]');
 const earnings=document.querySelector('[data-creator-earnings]');
 const requests=document.querySelector('[data-payout-requests]');
 if(proof)bindWalletProof(proof,{capabilityInput});
 if(earnings)bindCreatorEarnings(earnings,{capabilityInput});
 if(requests)bindPayoutRequests(requests,{capabilityInput});
}
