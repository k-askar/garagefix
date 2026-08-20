# تشغيل PitStock بواسطة Docker

## المتطلبات
- Docker Desktop (Windows / macOS) أو Docker Engine + Docker Compose plugin (Linux)

## خطوات سريعة

```bash
# 1) داخل مجلد المشروع
cp .env.example .env
# عدّل .env: ضع JWT_SECRET قوي، كلمة مرور مالك جديدة، وREACT_APP_BACKEND_URL

# 2) بناء وتشغيل الحاويات الثلاث (Mongo + Backend + Frontend)
docker compose up -d --build

# 3) افتح المتصفح
#    Frontend: http://localhost:3000
#    Backend:  http://localhost:8001/api
#    Mongo:    mongodb://localhost:27017
```

## بيانات الدخول الافتراضية
- المالك: `admin@garage.com` / `admin123` (تعديلها من `.env` قبل أول تشغيل)

## أوامر مفيدة

```bash
docker compose logs -f backend            # تتبّع سجلات الخادم
docker compose logs -f frontend           # تتبّع سجلات nginx
docker compose ps                         # حالة الحاويات
docker compose restart backend            # إعادة تشغيل الخادم فقط
docker compose down                       # إيقاف الحاويات
docker compose down -v                    # إيقاف + مسح بيانات Mongo (تحذير!)
```

## النسخ الاحتياطي لقاعدة البيانات

```bash
# نسخة احتياطية إلى مجلد ./backup
docker exec pitstock-mongo mongodump --db pitstock --out /dump
docker cp pitstock-mongo:/dump ./backup

# استعادة
docker cp ./backup pitstock-mongo:/dump
docker exec pitstock-mongo mongorestore /dump
```

## نشر إنتاجي (باختصار)
1. حدّث `REACT_APP_BACKEND_URL` في `.env` ليشير إلى الدومين العام (مثل `https://api.yourshop.com`).
2. ضع JWT_SECRET و WEBHOOK_CRON_SECRET قويّين (32+ حرف).
3. غيّر ADMIN_PASSWORD قبل التشغيل الأول.
4. اعرض المنافذ خلف Nginx/Traefik مع HTTPS.
5. لا تفتح المنفذ 27017 خارج الشبكة الخاصة — أزل mapping الـ MongoDB من `docker-compose.yml` في الإنتاج.
