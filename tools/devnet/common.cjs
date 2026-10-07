'use strict';
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {createRequire}=require('node:module');
const runtimeDir=process.env.BITPOS_DEVNET_RUNTIME||path.join(os.homedir(),'.cache','bitpos-devnet-tools');
const dependency=require.createRequire?require.createRequire(path.join(runtimeDir,'package.json')):createRequire(path.join(runtimeDir,'package.json'));
const web3=dependency('@solana/web3.js');
const spl=dependency('@solana/spl-token');
const bs58=dependency('bs58').default;
const root=path.resolve(__dirname,'../..');
const privateDir=process.env.BITPOS_DEVNET_KEY_DIR||path.join(os.homedir(),'Desktop','BitPOS-Devnet-Private');
if(path.resolve(privateDir)===root||path.resolve(privateDir).startsWith(root+path.sep))throw new Error('Private keys must stay outside the BitPOS repository');
const RPC='https://api.devnet.solana.com';
const DEVNET_GENESIS='EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const connection=new web3.Connection(RPC,{commitment:'confirmed',disableRetryOnRateLimit:true,fetch:async(input,init)=>fetch(input,{...init,signal:AbortSignal.timeout(30000)})});
const roles=JSON.parse(fs.readFileSync(path.join(__dirname,'roles.json'),'utf8'));
function secureDirectory(p){fs.mkdirSync(p,{recursive:true,mode:0o700});if(fs.lstatSync(p).isSymbolicLink())throw new Error('Private directory must not be a symlink');fs.chmodSync(p,0o700)}
function writePrivate(file,data){const p=path.join(privateDir,file);secureDirectory(path.dirname(p));fs.writeFileSync(p,typeof data==='string'?data:JSON.stringify(data,null,2)+'\n',{mode:0o600});fs.chmodSync(p,0o600)}
function readPrivate(file){const data=fs.readFileSync(path.join(privateDir,file),'utf8');try{return JSON.parse(data)}catch{throw new Error(`Invalid JSON in private file: ${file}`)}}
function key(role){return web3.Keypair.fromSecretKey(Uint8Array.from(readPrivate(`keys/${role}.json`)))}
function getOrCreateKey(role){secureDirectory(privateDir);secureDirectory(path.join(privateDir,'keys'));const file=path.join(privateDir,'keys',`${role}.json`);if(fs.existsSync(file))return key(role);const kp=web3.Keypair.generate();writePrivate(`keys/${role}.json`,Array.from(kp.secretKey));writePrivate(`import/${role}.base58.txt`,bs58.encode(kp.secretKey)+'\n');return kp}
function publicManifest(){return readPrivate('wallets.public.json')}
async function assertDevnet(){const hash=await connection.getGenesisHash();if(hash!==DEVNET_GENESIS)throw new Error(`Unexpected cluster genesis hash: ${hash}`);return hash}
function journal(event){secureDirectory(privateDir);fs.appendFileSync(path.join(privateDir,'activity.jsonl'),JSON.stringify({at:new Date().toISOString(),cluster:'devnet',...event})+'\n',{mode:0o600});fs.chmodSync(path.join(privateDir,'activity.jsonl'),0o600)}
async function refreshBalances(){await assertDevnet();const manifest=publicManifest();const accounts=await connection.getMultipleAccountsInfo(manifest.wallets.map(w=>new web3.PublicKey(w.address)));const balances=manifest.wallets.map((w,i)=>({...w,lamports:accounts[i]?.lamports||0,sol:(accounts[i]?.lamports||0)/web3.LAMPORTS_PER_SOL,accountExists:!!accounts[i]}));const result={cluster:'devnet',rpc:RPC,checkedAt:new Date().toISOString(),wallets:balances,totalSol:balances.reduce((sum,w)=>sum+w.sol,0)};writePrivate('balances.json',result);return result}
async function confirm(signature){const deadline=Date.now()+90000;while(Date.now()<deadline){const response=await connection.getSignatureStatuses([signature],{searchTransactionHistory:true});const status=response.value[0];if(status?.err)throw new Error(`Transaction failed: ${JSON.stringify(status.err)}`);if(status&&['confirmed','finalized'].includes(status.confirmationStatus))return status;await new Promise(resolve=>setTimeout(resolve,1600))}throw new Error(`Confirmation timeout; check signature before retry: ${signature}`)}
async function send(transaction,signers,event){await assertDevnet();const latest=await connection.getLatestBlockhash();transaction.recentBlockhash=latest.blockhash;transaction.feePayer=signers[0].publicKey;transaction.sign(...signers);const signature=bs58.encode(transaction.signature);journal({type:'signed',signature,lastValidBlockHeight:latest.lastValidBlockHeight,...event});writePrivate(`transactions/${signature}.json`,{signature,lastValidBlockHeight:latest.lastValidBlockHeight,serialized:transaction.serialize().toString('base64'),event});let returned;try{returned=await connection.sendRawTransaction(transaction.serialize(),{skipPreflight:false,maxRetries:3,preflightCommitment:'confirmed'})}catch(error){throw new Error(`${error.message}; check signature ${signature} before retrying`)}if(returned!==signature)throw new Error('RPC returned a different transaction signature');journal({type:'submitted',signature,...event});await confirm(signature);journal({type:'confirmed',signature,...event});return signature}
module.exports={fs,path,root,privateDir,runtimeDir,web3,spl,bs58,roles,connection,RPC,DEVNET_GENESIS,secureDirectory,writePrivate,readPrivate,key,getOrCreateKey,publicManifest,assertDevnet,journal,refreshBalances,confirm,send};
