const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const cors = require('cors');


const app = express();
const PORT = process.env.PORT || 3000;


app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
function categoryForExt(ext) {
    ext = ext.toLowerCase();
    const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'];
    const videoExts = ['.mp4', '.avi', '.mov', '.mkv', '.webm'];
    const docExts = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.txt', '.ppt', '.pptx'];

    if (imageExts.includes(ext)) return 'images';
    if (videoExts.includes(ext)) return 'videos';
    if (docExts.includes(ext)) return 'docs';
    return 'others';
}

app.use('/public', express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
const UPLOAD_ROOT = path.join(__dirname, 'uploads');
const TMP_DIR = path.join(UPLOAD_ROOT, 'tmp');
const CATEGORIES = ['images', 'videos', 'docs', 'others'];
if (!fs.existsSync(UPLOAD_ROOT)) fs.mkdirSync(UPLOAD_ROOT);
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR);
CATEGORIES.forEach(c => { const d = path.join(UPLOAD_ROOT, c); if (!fs.existsSync(d)) fs.mkdirSync(d); });

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, TMP_DIR),
    filename: (req, file, cb) => {
        // prepend timestamp to avoid collisions
        const uniqueName = Date.now() + '-' + file.originalname;
        cb(null, uniqueName);
    }
});

const upload = multer({ storage });
app.post('/upload-chunk', upload.single('chunk'), (req, res) => {
    try {
        const { fileName, totalChunks, chunkIndex } = req.body;
        if (!fileName) return res.status(400).json({ error: 'fileName required' });

        const chunkFile = req.file;
        if (!chunkFile) return res.status(400).json({ error: 'Chunk file missing' });

        // Save chunk in TMP_DIR using stable name
        const chunkDestName = `${fileName}.part${chunkIndex}`;
        const chunkDestPath = path.join(TMP_DIR, chunkDestName);
        fs.renameSync(chunkFile.path, chunkDestPath);

        // Check if all chunks are present
        const expected = parseInt(totalChunks || 1, 10);
        const parts = fs.readdirSync(TMP_DIR).filter(f => f.startsWith(fileName + '.part'));

        if (parts.length === expected) {
            // Assemble chunks into a single file in TMP_DIR
            const assembledPath = path.join(TMP_DIR, fileName);
            const writeStream = fs.createWriteStream(assembledPath);

            parts
                .sort((a, b) => parseInt(a.split('.part')[1]) - parseInt(b.split('.part')[1]))
                .forEach(p => {
                    const pPath = path.join(TMP_DIR, p);
                    const data = fs.readFileSync(pPath);
                    writeStream.write(data);
                    fs.unlinkSync(pPath); // remove chunk after writing
                });

            writeStream.end();

            // Move assembled file to category folder
            const ext = path.extname(fileName) || '';
            const cat = categoryForExt(ext);
            const catDir = path.join(UPLOAD_ROOT, cat);
            const finalName = `${Date.now()}-${fileName}`;
            const finalDest = path.join(catDir, finalName);

            fs.renameSync(assembledPath, finalDest); // ✅ move from TMP_DIR

            return res.json({ ok: true, assembled: true, file: `/uploads/${cat}/${finalName}` });
        }

        return res.json({ ok: true, assembled: false, partsReceived: parts.length });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: err.message });
    }
});



// Fallback single file upload (non-chunked)
app.post('/upload', upload.single('file'), (req, res) => {
    try {
        const file = req.file;
        if (!file) return res.status(400).json({ error: 'File missing' });

        const originalName = file.originalname;
        const ext = path.extname(originalName) || '';
        const cat = categoryForExt(ext);
        const catDir = path.join(UPLOAD_ROOT, cat);

        // Generate unique name to avoid collisions
        let finalName = `${Date.now()}-${originalName}`;
        let finalDest = path.join(catDir, finalName);
        let counter = 1;
        while (fs.existsSync(finalDest)) {
            finalName = `${Date.now()}-${counter}-${originalName}`;
            finalDest = path.join(catDir, finalName);
            counter++;
        }

        // Move file from TMP_DIR to category folder
        fs.renameSync(file.path, finalDest);

        return res.json({ ok: true, file: `/uploads/${cat}/${finalName}` });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: err.message });
    }
});


app.get('/files', (req, res) => {
    const list = [];
    for (const cat of CATEGORIES) {
        const dir = path.join(UPLOAD_ROOT, cat);
        const files = fs.readdirSync(dir).map(f => ({
            name: f,
            url: `/uploads/${cat}/${f}`,
            category: cat
        }));
        list.push(...files);
    }
    res.json(list);
});
// Download is handled by static /uploads route already, but we add a helper
app.get('/download', (req, res) => {
    const { path: p } = req.query;
    if (!p) return res.status(400).send('path required');
    const safePath = path.join(__dirname, p);
    if (!fs.existsSync(safePath)) return res.status(404).send('not found');
    return res.download(safePath);
});


app.get('/', (req, res) => res.redirect('/public/index.html'));
app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));