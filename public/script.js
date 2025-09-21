const fileInput = document.getElementById('fileInput');
const uploadsDiv = document.getElementById('uploads');
const fileList = document.getElementById('fileList');
const label = document.querySelector('.file-upload-label');

// ----------------------
// Toast notification
// ----------------------
function showToast(msg, type = "info") {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerText = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

// ----------------------
// Display selected files
// ----------------------
function showSelectedFiles(files) {
    uploadsDiv.innerHTML = '';
    Array.from(files).forEach(file => {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'upload-item';
        itemDiv.innerHTML = `<strong>${file.name}</strong><div class="progress-bar"></div>`;
        uploadsDiv.appendChild(itemDiv);
    });
}

// ----------------------
// Fetch uploaded files
// ----------------------
async function fetchFiles() {
    try {
        const res = await fetch('/files');
        const files = await res.json();
        if(Array.isArray(files) && files.length === 0) {
        fileList.innerHTML = '<li>No files uploaded yet.</li>';
        return;
        }
        fileList.innerHTML = '';
        files.forEach(f => {
            const li = document.createElement('li');
            li.innerHTML = `${f.name}-(${f.category}) <a href="${f.url}" target="_blank">Download</a>`;
            fileList.appendChild(li);
        });
    } catch (err) {
        showToast("Failed to load files", "error");
        console.error(err);
    }
}

// ----------------------
// Upload a file in chunks
// ----------------------
async function uploadFile(file) {
    const chunkSize = 5 * 1024 * 1024; // 5MB
    const totalChunks = Math.ceil(file.size / chunkSize);

    // Init upload
    let uploadId;
    try {
        const initRes = await fetch('/upload/init', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fileName: file.name, totalChunks })
        });
        const data = await initRes.json();
        uploadId = data.uploadId;
    } catch (err) {
        showToast("Upload init failed", "error");
        return;
    }

    // Progress bar
    const itemDivs = document.querySelectorAll('.upload-item');
    const itemDiv = Array.from(itemDivs).find(d => d.querySelector('strong').innerText === file.name);
    const progressBar = itemDiv.querySelector('.progress-bar');

    // Check existing uploaded chunks (resumable)
    const statusRes = await fetch(`/upload/status?uploadId=${uploadId}`);
    const statusData = await statusRes.json();
    const uploadedChunks = new Set(statusData.uploadedChunks || []);

    // Upload chunks sequentially
    for (let i = 1; i <= totalChunks; i++) {
        if (uploadedChunks.has(i)) {
            progressBar.style.width = `${(i / totalChunks) * 100}%`;
            continue;
        }

        const start = (i - 1) * chunkSize;
        const end = Math.min(start + chunkSize, file.size);
        const chunk = file.slice(start, end);
        const formData = new FormData();
        formData.append('chunk', chunk);
        formData.append('uploadId', uploadId);
        formData.append('chunkIndex', i);

        let success = false;
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                await fetch('/upload/chunk', { method: 'POST', body: formData });
                success = true;
                break;
            } catch (err) {
                if (attempt === 3) {
                    showToast(`Failed chunk ${i} of ${file.name}`, "error");
                    return;
                }
            }
        }

        if (success) progressBar.style.width = `${(i / totalChunks) * 100}%`;
    }

    // Complete upload
    try {
        const completeRes = await fetch('/upload/complete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ uploadId })
        });
        const result = await completeRes.json();
        if (result.ok) showToast(`Uploaded: ${file.name}`, "success");
        else showToast(result.error || `Error completing upload: ${file.name}`, "error");
    } catch (err) {
        showToast(`Error completing upload: ${file.name}`, "error");
    }

    fetchFiles();
}

// ----------------------
// Handle drag-drop
// ----------------------
['dragenter', 'dragover'].forEach(evt => {
    label.addEventListener(evt, e => {
        e.preventDefault();
        e.stopPropagation();
        label.classList.add('dragover');
    });
});
['dragleave', 'drop'].forEach(evt => {
    label.addEventListener(evt, e => {
        e.preventDefault();
        e.stopPropagation();
        label.classList.remove('dragover');
    });
});
label.addEventListener('drop', e => {
    const files = e.dataTransfer.files;
    if (!files.length) return;
    fileInput.files = files;
    showSelectedFiles(files);
    Array.from(files).forEach(file => uploadFile(file));
});

// ----------------------
// Handle input selection
// ----------------------
fileInput.addEventListener('change', () => {
    const files = fileInput.files;
    if (!files.length) return;
    showSelectedFiles(files);
    Array.from(files).forEach(file => uploadFile(file));
});

// ----------------------
// Initial file list
// ----------------------
fetchFiles();
