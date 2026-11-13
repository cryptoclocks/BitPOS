import sys;sys.path.insert(0,'docs/near-images/src')
from composite import place
from PIL import Image
P='/Users/cryptoclock/Desktop/BitPOS/BitPOS-Motion/public/product/';S='design/figcraft-near/previews/'
OUT='/private/tmp/claude-501/-Users-cryptoclock--claude-spares-spare-Ex5Mrn/52113aa9-fca0-4022-a294-91f4524b2deb/scratchpad/'
b=Image.open(P+'table-ordering-cafe.jpg').convert('RGB')
place(b,Image.open(S+'ND-01.png'),[(452,500),(852,486),(858,792),(462,806)])
place(b,Image.open(S+'NC-03.png'),[(902,420),(1020,420),(1127,690),(1018,690)],only_dark=True)
b.save(OUT+'probe1.jpg',quality=85)
