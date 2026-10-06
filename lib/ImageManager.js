(function () {
    "use strict";
    const api = globalThis.BannerAutomation ??= {};
    const { BannerImage } = api;

    class ImageManager {
        constructor() { this.cache = new Map(); }

        async fetchImage(input) {
            if (!this.cache.has(input.url)) this.cache.set(input.url, new BannerImage(input.url));
            const image = await this.cache.get(input.url).fetch();
            // Cache downloads by URL, but retain each banner's metadata and filename.
            return { ...image.toUploadData(), ...input };
        }

        async prefetchBannerImages(banner) {
            // Fail the banner if any required image fails to download.
            return Promise.all(banner.images.map(input => this.fetchImage(input)));
        }

        clear() { this.cache.clear(); }
    }

    api.ImageManager = ImageManager;
})();
