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

// ------------------------
// Configuration
// ------------------------
const UPLOAD_ROOT = path.join(__dirname, 'uploads');
const TMP_DIR = path.join(UPLOAD_ROOT, 'tmp');
const CATEGORIES = ['images', 'videos', 'docs', 'others'];

// Ensure directories exist
if (!fs.existsSync(UPLOAD_ROOT)) fs.mkdirSync(UPLOAD_ROOT);
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR);
CATEGORIES.forEach(c => {
    const dir = path.join(UPLOAD_ROOT, c);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
});

// Categorize by extension
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

// ------------------------
// Multer setup
// ------------------------
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, TMP_DIR),
    filename: (req, file, cb) => {
        cb(null, Date.now() + '-' + Math.random().toString(36).substring(2, 8));
    }
});
const upload = multer({ storage });

// ------------------------
// Safe JSON read
// ------------------------
function readJSON(filePath) {
    if (!fs.existsSync(filePath)) return null;
    const str = fs.readFileSync(filePath, 'utf8');
    if (!str.trim()) return null;
    try {
        return JSON.parse(str);
    } catch (err) {
        console.error('Failed to parse JSON:', filePath, err.message);
        return null;
    }
}

// ------------------------
// Init upload
// ------------------------
app.post('/upload/init', (req, res) => {
    const { fileName, totalChunks } = req.body;
    if (!fileName || !totalChunks) {
        return res.status(400).json({ error: 'fileName and totalChunks required' });
    }

    const uploadId = Date.now() + '-' + Math.floor(Math.random() * 10000);
    const manifest = {
        fileName,
        totalChunks: parseInt(totalChunks),
        uploadedChunks: []
    };
    fs.writeFileSync(path.join(TMP_DIR, `${uploadId}.json`), JSON.stringify(manifest));
    res.json({ uploadId });
});

// ------------------------
// Upload chunk
// ------------------------
app.post('/upload/chunk', upload.single('chunk'), (req, res) => {
    try {
        const { uploadId, chunkIndex } = req.body;
        if (!uploadId || !chunkIndex) {
            return res.status(400).json({ error: 'uploadId and chunkIndex required' });
        }

        const manifestPath = path.join(TMP_DIR, `${uploadId}.json`);
        const manifest = readJSON(manifestPath);
        if (!manifest) return res.status(400).json({ error: 'Invalid or missing manifest file' });

        const chunkFile = req.file;
        if (!chunkFile) return res.status(400).json({ error: 'Chunk file missing' });

        const chunkDest = path.join(TMP_DIR, `${uploadId}.part${chunkIndex}`);
        fs.renameSync(chunkFile.path, chunkDest);

        // Update manifest
        const idx = parseInt(chunkIndex);
        if (!manifest.uploadedChunks.includes(idx)) {
            manifest.uploadedChunks.push(idx);
        }
        fs.writeFileSync(manifestPath, JSON.stringify(manifest));

        res.json({ ok: true, uploadedChunks: manifest.uploadedChunks });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// ------------------------
// Upload status
// ------------------------
app.get('/upload/status', (req, res) => {
    const { uploadId } = req.query;
    if (!uploadId) return res.status(400).json({ error: 'uploadId required' });

    const manifestPath = path.join(TMP_DIR, `${uploadId}.json`);
    const manifest = readJSON(manifestPath);
    if (!manifest) return res.status(404).json({ error: 'Upload not found' });

    res.json({ uploadedChunks: manifest.uploadedChunks });
});

// ------------------------
// Complete upload
// ------------------------
app.post('/upload/complete', (req, res) => {
    try {
        const { uploadId } = req.body;
        if (!uploadId) return res.status(400).json({ error: 'uploadId required' });

        const manifestPath = path.join(TMP_DIR, `${uploadId}.json`);
        const manifest = readJSON(manifestPath);
        if (!manifest) return res.status(400).json({ error: 'Invalid uploadId or manifest missing' });

        if (manifest.uploadedChunks.length !== manifest.totalChunks) {
            return res.status(400).json({ error: 'Not all chunks uploaded yet' });
        }

        // Verify all chunk files exist
        for (let i = 1; i <= manifest.totalChunks; i++) {
            const chunkPath = path.join(TMP_DIR, `${uploadId}.part${i}`);
            if (!fs.existsSync(chunkPath)) {
                return res.status(400).json({ error: `Missing chunk file: part${i}` });
            }
        }

        const finalName = `${Date.now()}-${manifest.fileName}`;
        const ext = path.extname(manifest.fileName);
        const cat = categoryForExt(ext);
        const finalDest = path.join(UPLOAD_ROOT, cat, finalName);

        const writeStream = fs.createWriteStream(finalDest);

        (async () => {
            for (let i = 1; i <= manifest.totalChunks; i++) {
                const chunkPath = path.join(TMP_DIR, `${uploadId}.part${i}`);
                await new Promise((resolve, reject) => {
                    const rs = fs.createReadStream(chunkPath);
                    rs.pipe(writeStream, { end: false });
                    rs.on('end', () => {
                        fs.unlinkSync(chunkPath);
                        resolve();
                    });
                    rs.on('error', reject);
                });
            }
            writeStream.end();
        })();


        fs.unlinkSync(manifestPath);

        res.json({ ok: true, file: `/uploads/${cat}/${finalName}` });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// ------------------------
// Fallback single file upload
// ------------------------
app.post('/upload', upload.single('file'), (req, res) => {
    try {
        const file = req.file;
        const originalName = file.originalname;
        const ext = path.extname(originalName) || '';
        const cat = categoryForExt(ext);
        const finalName = `${Date.now()}-${originalName}`;
        const finalDest = path.join(UPLOAD_ROOT, cat, finalName);

        fs.renameSync(file.path, finalDest);
        return res.json({ ok: true, file: `/uploads/${cat}/${finalName}` });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: err.message });
    }
});

// ------------------------
// List files
// ------------------------
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

// ------------------------
// Download file
// ------------------------
app.get('/download', (req, res) => {
    const { path: p } = req.query;
    if (!p) return res.status(400).send('path required');
    const safePath = path.join(__dirname, p);
    if (!fs.existsSync(safePath)) return res.status(404).send('not found');
    res.download(safePath);
});

// ------------------------
app.use('/public', express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.get('/', (req, res) => res.redirect('/public/index.html'));

app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
