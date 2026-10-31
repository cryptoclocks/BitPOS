# พรอมต์วีดีโอสินค้า 5 วินาที (สำหรับเจนด้วยเครื่องมือภายนอก เช่น ChatGPT/Sora)

ตอนนี้ `apps/web/public/videos/menu/*.mp4` เป็นลูปที่ทำจากรูปจริงด้วย ffmpeg (ซูม/เลื่อนกล้อง ไม่ใช่วีดีโอ AI) ถ้าได้วีดีโอ AI มาแล้ว ให้วางไฟล์ทับชื่อเดิมได้เลย ไม่ต้องแก้โค้ดหรือฐานข้อมูล

## ข้อกำหนดไฟล์
- MP4 (H.264), 5 วินาที, ภาพจัตุรัส 720×720 (หรือ 1:1 ใหญ่กว่า), ไม่มีเสียง, ขนาดไม่เกิน ~1 MB
- ลูปต่อเนื่อง: เฟรมสุดท้ายต้องใกล้เฟรมแรก
- ห้ามมีตัวอักษร โลโก้ ราคา หรือลายน้ำในวีดีโอ (ข้อความอยู่ในแอป)
- ชื่อไฟล์ตามรายการด้านล่าง (ตัวพิมพ์เล็ก + ขีดกลาง)
- ถ้าไฟล์ไม่ใช่ 720×720 หรือมีเสียง ให้แปลงก่อนวาง: `ffmpeg -i in.mp4 -vf "crop='min(iw,ih)':'min(iw,ih)',scale=720:720" -an -c:v libx264 -crf 29 -movflags +faststart -t 5 out.mp4`

## พรอมต์พื้นฐาน (ใส่ทุกอัน)
> A seamless 5-second looping square (1:1) video, cinematic café food photography, warm natural window light, shallow depth of field, slow gentle camera movement, no people, no text, no logos, no watermark. The last frame matches the first so it loops.

## พรอมต์ต่อสินค้า (ต่อท้ายพรอมต์พื้นฐาน)
| ไฟล์ | พรอมต์เพิ่มเติม |
|---|---|
| `espresso.mp4` | A small red espresso cup on a saucer, thin steam rising, crema catching the light. |
| `americano.mp4` | Top-down view of a black americano in a white cup, tiny ripples on the surface, faint steam. |
| `latte.mp4` | A latte with heart-shaped latte art in a white cup with a navy rim, soft steam, slow push-in. |
| `iced-latte.mp4` | An iced latte in a tall glass, milk swirling into espresso, ice cubes slowly shifting, condensation on the glass. |
| `cappuccino.mp4` | A cappuccino with thick foam and a light cocoa dusting on a café table, gentle steam, slow pan. |
| `matcha.mp4` | A matcha latte with creamy green foam in a ceramic cup on a wooden table, slow swirl, soft steam. |
| `hot-chocolate.mp4` | A big cup of hot chocolate with rich froth, steam curling up, slow push-in. |
| `croissant.mp4` | Golden butter croissants on baking paper, flaky layers catching warm light, slow slide across the tray. |
| `blueberry-muffin.mp4` | A blueberry muffin with a golden domed top and visible blueberries, crumbs, slow orbit. |
| `chocolate-brownie.mp4` | A fudgy chocolate brownie square with a glossy crackled top, slow push-in. |
| `cheesecake.mp4` | A tall slice of creamy cheesecake on a plate with a crisp biscuit base, slow rotation. |
| `sandwich.mp4` | A grilled cheese sandwich being gently pulled apart, melted cheese stretching, steam, slow push-in. |

เรื่องราว ส่วนประกอบ และประโยชน์แก้ได้ใน POS (สินค้า → แก้ไขรายละเอียด → "เรื่องราวและวีดีโอ") ไม่ต้องใส่ในวีดีโอ
