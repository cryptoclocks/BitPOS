# OCI readiness audit สำหรับ BitPOS

ตรวจเครื่องจริงวันที่ **7 ตุลาคม 2026 ประมาณ 06:08–06:11 น. Asia/Bangkok** ผ่าน SSH และคำสั่งอ่านข้อมูลเท่านั้น

## ข้อสรุป

จาก snapshot ทรัพยากร มี headroom สำหรับ BitPOS staging ขนาดเล็ก เช่น API/worker ที่แยก service/network/config โดยยังไม่จำเป็นต้อง prune Docker จำนวนมาก นี่เป็น capacity assessment ไม่ใช่ผล load test หรือการรับรอง production readiness

ยังไม่เริ่มติดตั้ง BitPOS, สร้าง database/schema/Auth, เปลี่ยน firewall/DNS, deploy, restart หรือ cleanup บน OCI

## ทรัพยากรที่วัดจริง

| รายการ | ผล |
|---|---|
| Architecture | ARM64 / aarch64 |
| Logical CPUs | 4 |
| Load average 1/5/15 นาที | ประมาณ 1.45 / 0.86 / 0.93 |
| RAM รวม / available | ประมาณ 23.42 / 10.17 GiB |
| Swap | ไม่มี |
| Root disk รวม / available | ประมาณ 193.63 / 31.98 GiB; ใช้ประมาณ 83.5% |
| Free inodes | ประมาณ 24.17 ล้านจาก 25.93 ล้าน |
| Docker Engine | 28.2.2 |
| Containers จาก inspect snapshot | 69 รวม; running 60, stopped 9 |
| Running containers health | ไม่พบตัวที่รายงาน unhealthy; บางตัวไม่มี healthcheck จึงไม่ถือว่าตรวจ app functionality แล้ว |

จำนวน CPU/หน่วยความจำเป็นค่าที่ OS เห็น ไม่ได้ยืนยัน OCI billing shape/OCPU quota เครื่องนี้มี workload อื่นอยู่มาก ต้องตั้ง resource limits และวัดหลังเริ่ม staging

## Docker และรายการ cleanup

`docker system df` รายงาน:

| ประเภท | ใช้ | Reclaimable ตาม Docker |
|---|---:|---:|
| Images | 29.2 GB | 14.16 GB |
| Container writable layers | ประมาณ 4.455 GB | 21.59 MB |
| Volumes | 1.478 GB | 41.18 MB |
| Build cache | 0 B | 0 B |

Images count ตาม system df คือ 84 โดย 47 active; การ inspect ด้วย `image ls -a` รวม intermediate images เพิ่มด้วย จึงไม่ใช้จำนวน inventory แบบนั้นแทน df และไม่รวม size ของทุก image เป็นพื้นที่ที่จะคืน

### Candidate ที่ไม่ผูกกับ container

พบ `dangling=true` 7 image IDs โดย 2 ตัวมี container อ้างถึง และ 5 ตัวไม่มี container อ้างถึง ณ snapshot นี้:

| Image ID | Unique size จาก `docker system df -v` |
|---|---:|
| `a60fb630db9a` | 63.65 kB |
| `309e6b9c7888` | 63.63 kB |
| `c5a57ea74d1b` | 63.62 kB |
| `d98a927f3f6e` | 62.88 kB |
| `06a5194c19d3` | 62.73 kB |

Unique size รวมประมาณ **316.51 kB** แม้แต่ละ image แสดง size 191 MB เพราะ layers ส่วนมากใช้ร่วมกัน ตัวเลข unique เป็นประมาณการ ไม่ใช่ผล cleanup จริง รอบนี้ไม่ได้ลบ image ใด

32 tagged images ที่ไม่มี container อ้างถึงมีทั้ง `ccp-api:*` candidate/canary/staging builds, `cashless-arcade:*` และ base/tool images จึงต้องกำหนด retention/rollback requirements ก่อนเลือก IDs ห้ามเหมาว่า reclaimable 14.16 GB เป็นขยะทั้งหมด

Stopped containers รวมถึง backups และ rehearsal DB ไม่ได้ลบหรือ prune Volumes ที่ reclaimable เพียงประมาณ 41 MB ไม่มีเหตุให้เสี่ยงล้างเพื่อคืนพื้นที่เล็กน้อย

ผล cleanup เดิมวันที่ 4 ตุลาคมใน `Desktop/OCI/docker-cleanup-result-2026-10-04.md` รายงาน filesystem available เพิ่มประมาณ 9.25 GB; รอบนี้ยืนยันว่าดิสก์ยังเหลือประมาณ 34.33 GB decimal และ build cache เป็นศูนย์

## Log growth

| Container | Log bytes โดยประมาณ | Rotation ที่ container ใช้ |
|---|---:|---|
| `ccp-production-oci-live-api` | 979 MB | json-file; ไม่มี max-size/max-file |
| `ccp-production-api-real` | 145 MB | json-file; ไม่มี max-size/max-file |
| API เก่าที่หยุดแล้ว | 85 MB | json-file; ไม่มี max-size/max-file |
| `supabase-pooler` | 66 MB | json-file; ไม่มี max-size/max-file |
| `ccp-production-supabase-pooler` | 66 MB | json-file; ไม่มี max-size/max-file |

จุดที่มีประโยชน์กว่าลบ dangling ชุดเล็กคือเพิ่ม log rotation ตอน deploy ที่กำหนดไว้ และกำหนด retention ของ tagged images โดยเก็บ rollback ที่จำเป็น การเปลี่ยน logging ของ container เดิมเป็นงาน deploy/recreate แยกต่างหาก รอบนี้ไม่ได้ truncate log หรือแก้ Docker storage directories

## Supabase topology ที่ยืนยันได้

- มีสอง compose projects: `supabase` และ `ccp-production-supabase` พร้อม DB/Auth/REST/Storage/gateway และบริการประกอบ; containers ที่ตรวจในสองชุดรายงาน healthy
- มี rehearsal DB v2 รันและ healthy รวมถึง rehearsal auth/web/MQTT อีกชุด
- rehearsal DB รุ่นเก่า exited และเก็บ health status unhealthy จากครั้งก่อน ไม่ใช่ unhealthy running service
- API ที่รันอยู่มี upstream hostnames ภายใน `db:5432` และ `gateway:8080`; ไม่บันทึก credentials, URLs ที่มี user/password หรือ environment values ทั้งชุด
- SQL metadata queries บน DB ทั้งสามใช้ `default_transaction_read_only=on` และ statement timeout อ่านเฉพาะ aggregate sizes/connections ไม่มีการอ่าน customer rows

| Database container | ผลรวม non-template database bytes | Connections ณ query / max |
|---|---:|---:|
| `supabase-db` | 25,303,334 | 29 / 100 |
| `ccp-production-supabase-db` | 24,860,966 | 25 / 100 |
| `ccp-production-rehearsal-db-v2` | 50,837,798 | 9 / 100 |

ตัวเลข DB เป็น logical database sizing จาก Postgres ไม่รวม WAL, storage objects, volumes หรือ backup จึงไม่ใช้แทนขนาด data directory รวม ไม่ยืนยันเจ้าของข้อมูล/หน้าที่ของแต่ละ stack จากชื่อเพียงอย่างเดียว

## งานเตรียมก่อน deploy BitPOS

1. เลือก staging data/Auth boundary ของ BitPOS ให้ชัดเจน มี credentials/membership/storage/RLS ของตัวเอง ไม่ย้ายเข้า CryptoClock production โดยอัตโนมัติ
2. ใช้ service/image/network names ของ BitPOS และ host ports ที่ไม่ชน; prefer private network/loopback หลัง reverse proxy ก่อนเปิด route
3. ตั้ง memory/CPU limits, image retention และ log rotation ตั้งแต่ compose ของ BitPOS รุ่นแรก; build/pull ARM64 images ที่ทดสอบแล้ว
4. ถ้าจะเพิ่ม Supabase stack เต็มอีกชุดหรือเพิ่ม data volume ให้ทำ storage/capacity budget ก่อน ไม่ถือว่า RAM ว่างพอแปลว่าดิสก์และ I/O พร้อมด้วย
5. ตรวจ backup/restore ของ data boundary ที่เลือก, webhook/auth callback configuration, TLS/routes และ staging health ก่อนรับ payments จริง
6. วัด CPU/memory/disk growth/latency หลังเริ่ม staging; readiness สำหรับ production ต้องมีหลักฐานเพิ่ม

รอบนี้ไม่จำเป็นต้อง cleanup ครั้งใหญ่เพื่อเริ่มพัฒนา และยังไม่มีการ provision OCI resource ใหม่

## Evidence

ไฟล์ local นอก repository (ไม่มีการ dump Env/secrets/customer records):

- `/Users/cryptoclock/Desktop/OCI/oci-preflight-2026-10-07.json`
- `/Users/cryptoclock/Desktop/OCI/oci-docker-details-2026-10-07.json`
- `/Users/cryptoclock/Desktop/OCI/oci-database-capacity-2026-10-07.json`
- `/Users/cryptoclock/Desktop/OCI/oci-db-total-size-2026-10-07.json`

เอกสารอ้างอิง: [Docker pruning behavior](https://docs.docker.com/engine/manage-resources/pruning/), [Supabase self-hosting requirements](https://supabase.com/docs/guides/self-hosting/docker)
