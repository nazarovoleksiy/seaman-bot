// utils/image.js
import axios from 'axios';
import sharp from 'sharp';

/**
 * Скачивает фото Telegram и приводит к читаемому виду:
 * поворот, ч/б, нормализация контраста, resize, sharpen.
 * Возвращает data: URL (base64), который можно передать как image_url в OpenAI.
 */
export async function preprocessToDataUrl(fileUrl) {
    const resp = await axios.get(fileUrl, { responseType: 'arraybuffer' });
    const buf = Buffer.from(resp.data);
    const out = await sharp(buf)
        .rotate()                       // авто-поворот по EXIF
        .grayscale()
        .normalize()
        .resize({ width: 1280, withoutEnlargement: true })
        .sharpen()
        .jpeg({ quality: 85 })
        .toBuffer();

    return `data:image/jpeg;base64,${out.toString('base64')}`;
}
