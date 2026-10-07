# BitPOS Devnet wallets — 2026-10-07

ผู้ใช้อนุญาตให้สร้างกระเป๋าทดลองแยกทุก role เก็บคีย์บน Mac รับเหรียญทดสอบฟรีและแจกต่อ ชุดนี้แยกจากกระเป๋า/ระบบเดิมทั้งหมด

## คีย์บน Mac

- โฟลเดอร์ส่วนตัว: `/Users/cryptoclock/Desktop/BitPOS-Devnet-Private/` อยู่ **นอก repository**
- `keys/<role>.json`: Solana keypair 64 bytes สำหรับ CLI/SDK
- `import/<role>.base58.txt`: private key สำหรับ import เข้า wallet ที่รองรับ ไม่ใช่ seed phrase
- `wallet-index.csv`: รายชื่อ role, public address, ชื่อไฟล์ และเป้าหมาย SOL
- `balances.json`, `usdg-balances.json`, `activity.jsonl`, `transactions/`: snapshot และ audit ของการทดสอบ
- สิทธิ์โฟลเดอร์ `700`; ไฟล์ส่วนตัว `600` จำกัดให้บัญชี macOS เจ้าของอ่านได้
- Repository เก็บเฉพาะเครื่องมือ, public address และ snapshot; `.gitignore` ป้องกัน keypair/import files เพิ่มอีกชั้น ไม่ส่งคีย์เข้า GitHub, AI, firmware หรือ frontend

## ครบ 19 role

| Role | Devnet SOL เป้าหมาย | ใช้ทดลอง |
|---|---:|---|
| reserve | 2 เป็นขั้นต่ำ | รับ faucet และเติมเงินให้ role อื่น มีเงินเหลือเพิ่มได้ |
| platform-admin | 0.25 | ตัวตน admin แพลตฟอร์ม |
| merchant-a-owner | 0.50 | เจ้าของร้าน A / อนุมัติแคมเปญ |
| merchant-a-manager | 0.25 | ผู้จัดการร้าน A |
| merchant-a-staff | 0.25 | พนักงานร้าน A |
| merchant-a-treasury | 1.00 | รับจ่ายและคืนเงินร้าน A |
| merchant-b-owner | 0.50 | เจ้าของร้าน B / แยก tenant |
| merchant-b-manager | 0.25 | ผู้จัดการร้าน B |
| merchant-b-staff | 0.25 | พนักงานร้าน B |
| merchant-b-treasury | 0.50 | ร้าน B / wrong recipient |
| customer-alice | 0.50 | ซื้อสินค้า / loyalty ปกติ |
| customer-bob | 0.50 | รายการพร้อมกัน / duplicate callback |
| customer-charlie | 0.50 | refund / quote หมดอายุ |
| customer-diana | 0.50 | NFT / claim / voucher |
| fee-sponsor | 1.00 | จ่ายค่าธรรมเนียมแทนลูกค้า |
| reward-issuer | 2.00 | signer สำหรับออกสินทรัพย์ทดลอง; ไม่มอบ key ให้ AI |
| program-deployer | 5.00 | เงินสำรอง deploy โปรแกรมในเฟสถัดไป |
| unauthorized-user | 0.25 | wallet มีเงิน แต่ไม่มีสิทธิ์ร้าน |
| customer-no-sol | **0 ตั้งใจ** | มี USDG แต่ไม่มี SOL เพื่อทดสอบ sponsorship |

รวมเป้าหมาย **16 SOL** บวกค่าเปิดบัญชี/transaction และเงินสำรองเพิ่ม โค้ดแจก 14 SOL ให้ role อื่นหลังตรวจว่ามีเงินเหลือใน reserve อย่างน้อย 2.1 SOL ไม่ได้ deploy โปรแกรม BitPOS หรือสร้างบัญชี Auth/RLS ด้วยการสร้าง wallet นี้

### ชุดเริ่มต้น: ขอ 1 SOL ก่อน

ไม่ต้องรอครบ 16 SOL เพื่อเริ่มทดสอบ transfer/refund/sponsorship ชุดเริ่มต้นรวม **0.78 SOL**:

- reserve 0.10; fee-sponsor 0.10; reward-issuer 0.20; program-deployer 0.10 SOL
- อีก 14 role ที่ต้องใช้ค่าธรรมเนียม role ละ 0.02 SOL
- customer-no-sol คง **0 SOL**

คำสั่ง `distribute-starter` ต้องมี reserve อย่างน้อย **0.79 SOL** เมื่อยังไม่มี role ใดได้รับ SOL: แจก 0.68 แล้วเก็บ 0.11 สำหรับ reserve/ค่าแจก เมื่อรับ 1 SOL จึงเริ่มได้ ชุดนี้เตรียมไว้สำหรับธุรกรรมทดลองและบัญชีสินทรัพย์ขนาดเล็ก; deployer 0.10 SOL ยังไม่ใช่งบสำหรับ deploy โปรแกรมเต็มรูปแบบ เป้าหมาย 16 SOL เป็นเงินเผื่อเพิ่มเติมตามคำขอเดิม

การแบ่งชื่อ wallet ไม่ได้บังคับสิทธิ์ owner/manager/staff บนเชนหรือใน POS ต้องสร้างและตรวจ Auth/RBAC/RLS ตามเฟสที่วางไว้ เฟิร์มแวร์และ AI draft ไม่ต้องมี wallet ส่วนตัว

## USDG ที่ใช้ทดลอง

ใช้ **USDG จาก Paxos sandbox บน Solana Devnet** โดยตรง ตาม [faucet ของ Paxos](https://faucet.paxos.com/?token=USDG&network=SOLANA):

- Mint: `4F6PM96JJxngmHnZLBh9n58RH4aTVNWvDs2nuwrT5BP7`
- Token program: `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb` (Token-2022)
- Decimals: **6**, เก็บ/ตรวจจำนวนเป็น integer minor units
- Faucet ให้ **100 token ต่อ wallet ต่อวัน**; เครื่องมือขอแต่ละ role หนึ่งครั้งและเว้นอย่างน้อย 61 วินาทีระหว่าง request ตาม cooldown ของหน้า faucet
- เป้าหมาย **100 USDG test ทุก role = 1,900 USDG test**; เป็นสินทรัพย์ Devnet ไม่มีมูลค่า USD จริง
- ข้อมูลนี้เป็น **devnet mint** ต้องเปลี่ยน configuration เมื่อพัฒนา mainnet ห้ามนำ mint นี้ไปใช้รับเงินจริง
- ทดสอบจ่าย USDG ได้โดยไม่ต้องสร้างเหรียญ CLOCK; เงิน SOL ของ reward issuer เตรียมไว้สำหรับสร้าง/ทดสอบ NFT ในเฟสถัดไป

การตอบ API `200` เป็นแค่รับคำขอ เครื่องมืออ่าน token account และยืนยัน mint, program, owner และ decimals อีกครั้งก่อนนับเป็นยอดที่มีจริง หน้า dashboard ระบุเวลา snapshot ไว้

ตรวจ mint เมื่อ 2026-10-07 พบ transfer fee configuration และ transfer hook extension: ค่าธรรมเนียม ณ snapshot เป็น 0 และ hook program เป็น system-program address (ปิดใช้งาน) จึงใช้ `TransferCheckedWithFee` กับ expected fee 0 ได้ใน smoke script ถ้าค่าเหล่านี้เปลี่ยน script หยุดให้ทบทวน quote/extra accounts ก่อนส่ง ไม่เหมารวมว่าค่าธรรมเนียมจะเป็น 0 ตลอดไป

## เริ่มทดลอง

เปิด `devnet/index.html` เพื่อดู role/address/balance หรือใช้ preview `http://127.0.0.1:8767/devnet/` เมื่อ local server เดิมทำงานอยู่ หน้า dashboard ไม่เก็บหรือโหลด private key

ใน wallet app ที่รองรับ ให้เปิด Devnet แล้ว import private key จาก `import/<role>.base58.txt` เฉพาะ role ที่ต้องใช้ กระเป๋า service เช่น treasury/sponsor/reward/deployer สำหรับ backend/CLI ที่เชื่อถือได้ ไม่ใส่ในแอปลูกค้าหรือเครื่อง POS

ติดตั้ง tooling dependency ที่แยกจาก POS runtime:

```sh
npm install --prefix "$HOME/.cache/bitpos-devnet-tools" --ignore-scripts --no-fund --no-audit --save-exact @solana/web3.js@1.98.4 @solana/spl-token@0.4.15 bs58@6.0.0
```

รันจาก `/Users/cryptoclock/Desktop/BitPOS`:

```sh
# สร้าง role ที่ยังไม่มีเท่านั้น; รันซ้ำใช้คีย์เดิม
node tools/devnet/setup.cjs
# ดู SOL และ USDG ที่ยืนยันบนเชน
node tools/devnet/fund.cjs balances
node tools/devnet/paxos.cjs balances
# ดูว่า PoW faucet มี pool ที่คุ้มค่าและมีเงินพอหรือไม่ (อ่านอย่างเดียว)
node tools/devnet/pow-status.cjs
# รับ faucet ปกติ ถ้าได้ 429 ให้เคารพโควตา
node tools/devnet/fund.cjs airdrop 2
# ขอ USDG ทุก role, ข้ามรายการที่ขอแล้วใน 24 ชั่วโมง
node tools/devnet/paxos.cjs request-all
# แจกชุดเริ่มต้น หลัง reserve มีอย่างน้อย 0.79 SOL
node tools/devnet/fund.cjs distribute-starter
# หลังมี SOL และ USDG ครบ ทดสอบโอน/คืน 1 USDG และ sponsored payment
node tools/devnet/smoke.cjs
# เติม SOL จำนวนเล็กน้อยที่ smoke ใช้ไป ให้กลับถึงเป้าหมายทุก role
node tools/devnet/fund.cjs distribute-starter
# refresh USDG ก่อนตรวจ
node tools/devnet/paxos.cjs balances
# ตรวจคีย์/สิทธิ์ไฟล์/ยอดจริง; exit 2 ถ้าทรัพยากรยังไม่ครบ
node tools/devnet/verify.cjs --starter --require-funded
# อัปเดตเฉพาะ public snapshot ใน dashboard
node tools/devnet/export.cjs
```

เมื่อมีเงินเพียงพอสำหรับเป้าหมายเต็ม ใช้ `fund.cjs distribute` และ `verify.cjs --require-funded` โดยไม่ใส่ `--starter`

เครื่องมือกำหนด RPC เป็น `https://api.devnet.solana.com` และตรวจ genesis hash `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG` ก่อนอ่าน/ส่งรายการ คำสั่งส่ง transaction เก็บ signature และ serialized signed transaction ไว้ก่อน broadcast เพื่อให้ตรวจสอบรายการเดิมได้เมื่อ RPC/confirmation timeout ไม่สร้างรายการซ้ำแบบไม่ตรวจ

## Faucet / mining / ค่าใช้จ่าย

[เอกสาร Solana](https://solana.com/developers/cookbook/development/airdrops-and-faucets) ระบุ airdrop, faucet และ PoW faucet ของ Ellipsis Labs การทำ PoW นี้เป็นการคำนวณเพื่อรับ **เหรียญทดสอบจาก pool** ไม่ใช่ขุดเหรียญ SOL ที่มีมูลค่าจริง

ในรอบนี้ public airdrop ตอบ internal error แล้ว 429; อ่าน pool ของโปรแกรม `PoWSNH2hEZogtCg1Zgm51FnkmJperzYDgPK4fvs8taL` พบว่าไม่มี pool ที่มี reward คุ้มค่าและเงินพอ ไม่เปิด mining ให้เสียเวลาหรือใช้ CPU โดยไม่ได้รับเหรียญ

ช่องทางให้คนรับเหรียญและนำมาแจกต่อ:

- [Solana Foundation faucet](https://faucet.solana.com/): ลองขอ 1 SOL ที่อยู่ reserve ผ่านหน้าเว็บด้วยตนเอง โควตาพื้นฐานจำกัด 2 request ต่อ 8 ชั่วโมง; GitHub ใช้เพิ่มวงเงินและบางบัญชีไม่ผ่านการตรวจ ผู้ให้บริการระบุว่า AI agents ให้ใช้ช่องทาง programmatic แทน จึงไม่ใช้ automation กดรับแทนคน
- [DevnetFaucet.org](https://www.devnetfaucet.org/): ช่องทาง 20 SOL ต้องตรวจสิทธิ์จาก repository ใน ecosystem ไม่ใช่แค่ล็อกอิน GitHub [source ของ faucet](https://github.com/ferric-sol/devnetfaucet#data-attribution) ระบุใช้ข้อมูล Electric Capital Crypto Ecosystems ผู้ใช้ได้รับ “No eligible repository found in Solana ecosystem”; ต้องเลือก Request Access และขอ vouch จาก developer ที่มีสิทธิ์ตาม UI ถ้าจะใช้เส้นทางนี้ ไม่มีเวลาอนุมัติที่ยืนยันได้ และ anonymous ไม่ข้ามเกณฑ์สิทธิ์
- [Pine Stake](https://www.pinestake.com/en/faucet): GitHub + Turnstile, จำนวน 1/2/5/10 SOL และ cooldown 8 ชั่วโมง ตาม [เอกสาร faucet](https://docs.pinestake.com/api/faucet)

หากต้องการกรอก “Why do you need devnet SOL?” ในเส้นทาง Request Access ข้อความนี้อธิบายงานที่กำลังพัฒนาได้ตรงจริง (ยังไม่ได้ส่งคำขอ):

> I am building BitPOS, a Solana-enabled POS and touchscreen payment terminal for shops. I need devnet SOL to test USDG payments, refunds, fee-sponsored customer transactions, and planned NFT loyalty rewards. We have 19 isolated test wallets covering two merchants, customers, a fee sponsor, and service roles. The funds will be used only on devnet for development and testing.

ไม่มีการซื้อ SOL mainnet หรือใช้กระเป๋าเดิมของผู้ใช้ Devnet SOL/USDG ไม่มีมูลค่าเงินจริงและ faucet ฟรี แต่มีโควตา/เงื่อนไข และ Devnet อาจ reset ตาม [เอกสาร cluster](https://solana.com/docs/references/clusters) เงินสำรอง deploy เป็นแค่ devnet SOL

## ยืนยันก่อนเชื่อม POS

1. ตรวจ 19 public address ไม่ซ้ำ, keypair กับ import ให้ address เดียวกัน และ private file mode ถูกต้อง
2. ยืนยัน SOL ตาม role; `customer-no-sol` ต้อง 0 SOL แม้มี USDG
3. ยืนยัน USDG จาก mint/program ที่ระบุและ token account owner ของแต่ละ role
4. เมื่อตัว POS เริ่ม implement ให้ตรวจ successful transaction, recipient, exact quote และ order reference ฝั่ง backend การมี wallet/ยอดทดสอบยังไม่ใช่การทดสอบ order lifecycle หรือ NFT redemption

ดู snapshot จริงล่าสุดใน `devnet/wallets.public.json`; ห้ามสรุปว่าเติมครบจากค่า target อย่างเดียว

## Live funding / smoke snapshot — 2026-10-07

Received 10 devnet SOL in reserve; starter distribution and four USDG transfer/refund tests confirmed, including zero-SOL sponsored customer. After fee top-up: total SOL 9.99995, reserve 9.31995; all 19 wallets retain 100 USDG each. Starter verification passed; full 16 SOL profile not reached. Public transaction links appear in devnet dashboard. No Kora/POS/NFT/hardware test is implied.
