// Shared userscript module. Loaded by Tampermonkey @require.
(function () {
    "use strict";
    const api = globalThis.BannerAutomation ??= {};

class BannerImage {
    constructor(url) {
        this.url = url;
        this.blob = null;
        this.dimensions = null;
        this.filename = null;
        this.filetype = null;
        this.isLoaded = false;
        this.error = null;
    }

    async fetch() {
        if (this.isLoaded) return this;
        if (this.pending) return this.pending;
        this.pending = this._load();
        try { return await this.pending; }
        finally { this.pending = null; }
    }

    async _load() {

        try {
            this.blob = await this._fetchBlob();
            this.dimensions = await this._extractDimensions();
            this.filetype = this._getExtensionFromMimeType(this.blob.type);
            this.filename = this._generateFilename();
            this.isLoaded = true;
            this.error = null;
        } catch (err) {
            this.error = err;
            console.error(`Failed to fetch image ${this.url}:`, err);
            throw err;
        }

        return this;
    }

    async _fetchBlob() {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "GET",
                url: this.url,
                responseType: "blob",
                timeout: 60000,
                ontimeout() { reject(new Error("Image download timed out")); },
                onabort() { reject(new Error("Image download aborted")); },
                onload(response) {
                    if (response.status >= 200 && response.status < 300) {
                        if (!response.response || response.response.size === 0) reject(new Error("Image download was empty"));
                        else resolve(response.response);
                    } else {
                        reject(new Error(`HTTP ${response.status}`));
                    }
                },
                onerror(error) {
                    reject(new Error(error?.error || "network error"));
                },
            });
        });
    }

    async _extractDimensions() {
        const objectUrl = URL.createObjectURL(this.blob);

        try {
            const img = new Image();

            await new Promise((resolve, reject) => {
                img.onload = resolve;
                img.onerror = reject;
                img.src = objectUrl;
            });

            return {
                width: img.naturalWidth,
                height: img.naturalHeight,
            };
        } finally {
            URL.revokeObjectURL(objectUrl);
        }
    }

    _generateFilename() {
        // Try to extract filename from URL
        try {
            const pathname = new URL(this.url).pathname;
            const base = pathname.split("/").pop();
            if (base && /\.[a-zA-Z0-9]+$/.test(base)) {
                return base;
            }
        } catch {
            /* fall through to generated name */
        }

        // Generate filename with correct extension from MIME type
        const extension = this._getExtensionFromMimeType(this.blob.type);
        return `upload-${Date.now()}.${extension}`;
    }

    _getExtensionFromMimeType(mimeType) {
        const mimeMap = {
            'image/jpeg': 'jpg',
            'image/jpg': 'jpg',
            'image/png': 'png',
            'image/gif': 'gif',
            'image/webp': 'webp',
            'image/svg+xml': 'svg',
            'image/bmp': 'bmp',
            'image/tiff': 'tiff'
        };

        return mimeMap[mimeType] || 'jpg';
    }

    toUploadData() {
        if (!this.isLoaded) {
            throw new Error(`Image not loaded: ${this.url}`);
        }

        return {
            url: this.url,
            blob: this.blob,
            filename: this.filename,
            filetype: this.filetype,
            dimensions: this.dimensions
        };
    }
}

    api.BannerImage = BannerImage;
})();
