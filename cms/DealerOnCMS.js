// Shared userscript module. Loaded by Tampermonkey @require.
(function () {
    "use strict";
    const api = globalThis.BannerAutomation ??= {};
    const { Utils, BannerInput } = api;

class DealerOnCMS {
    static async waitForContext(timeout = 30000) {
        const deadline = Date.now() + timeout;
        let lastError;
        do {
            try { return new DealerOnCMS(); }
            catch (error) { lastError = error; }
            await new Promise(resolve => setTimeout(resolve, 250));
        } while (Date.now() < deadline);
        throw lastError;
    }

    selectImages(banner) { return [BannerInput.primaryImage(banner)]; }

    getWarnings(banner) {
        const warnings = BannerInput.commonWarnings(banner);
        if (banner.images.length > 1) warnings.push("DealerOn has a max of one image per banner; additional images are ignored.");
        return warnings;
    }

    constructor() {
        const appRoot = unsafeWindow.document.getElementById("app");
        if (!appRoot) {
            throw new Error("DealerOn app root element not found");
        }

        const context = this._detectContext(appRoot);
        
        this.dealerId = context.dealerId;
        this.accessToken = context.accessToken;
        this.environment = context.environment; // 'cms' or 'gallery'
        
        console.log(`DealerOnCMS initialized: dealerId=${this.dealerId}, env=${this.environment}`);
    }

    _detectContext(appRoot) {
        // Try Vue 2 path (CMS)
        const vueDealer = appRoot?.__vue__?.$parent?._computedWatchers?.websiteId?.value;
        if (vueDealer) {
            return {
                dealerId: vueDealer,
                accessToken: JSON.parse(unsafeWindow.IdentityConfig.userStore._store["oidc.user:https://account.dealeron.com:cmsfrontend"]).access_token,
                environment: 'cms'
            };
        }

        // Try Vue 3 path (Gallery)
        const vNodeDealer = appRoot?._vnode?.component?.subTree?.dynamicChildren?.[1]?.props?.['dealer-id'];
        if (vNodeDealer) {
            const piniaToken = appRoot._vnode.appContext.config.globalProperties.$pinia.state._value.userStore.user.access_token;
            return {
                dealerId: vNodeDealer,
                accessToken: piniaToken,
                environment: 'gallery'
            };
        }

        throw new Error("Could not detect DealerOn context (dealerId not found in Vue or VNode)");
    }

    async init() {
        // Reserved for future initialization logic
    }

    async uploadImage(imageBlob, filename = "placeholder.jpg") {
        const url = `https://mdiasaa.dealeron.com/api/Assets/${this.dealerId}/dealer-${this.dealerId}/${encodeURIComponent(filename)}`;
        
        const response = await fetch(url, {
            method: "PUT",
            credentials: "same-origin",
            headers: {
                "Accept": "application/json, text/plain, */*",
                "Authorization": `Bearer ${this.accessToken}`,
                "Content-Type": imageBlob.type,
                "Origin": "https://gallery.dealeron.com/",
                "Referer": "https://gallery.dealeron.com/",
            },
            body: imageBlob
        });

        if (!response.ok) {
            throw new Error(`Image upload failed: ${response.status} ${response.statusText}`);
        }

        let data = await response.json();

        return data.url;
    }

    async uploadBanner(banner, cachedImages = []) {
        let uploadedImages = await this._uploadAllImages(cachedImages);
        //there should only be one uploaded image for DealerOn banners
        if(!uploadedImages[0]){
            throw new Error("No Image uploaded to CMS");
        }
        let image = uploadedImages[0];
        //get relative cms path used for banner
        let removalStr = `https://cdn.dlron.us/static/dealer-${this.dealerId}/`;
        let relPath = image.uploadedUrl.replace(removalStr, "#MISCPATH#");

        let bannerData = [{
            dealerId: this.dealerId,
            dealerVehiclePhotoId: 0,
            displayOrder: 100, //TODO: figure out how to find what the display order of this should be
            isGallery: true,
            name:  image.filename,
            path: relPath,
            type: image.filetype,
        }];

        // DealerOn doesn't respond with any data on creation, just the response status code
        await this._createBannerRecord(bannerData);
        //platform doesn't have a way to fetch specific banners so we have to get all of them and filter to find ours
        let allBanners = await this._fetchAllBanners();
        let responseData = allBanners.find(b => b.path === relPath) ?? null;
        if(!responseData){
            throw new Error(`Unable to find newly created banner with path: ${relPath}`);
        }

        const startDate = banner.start_date;
        const expiresDate = banner.end_date;

        let overrides = {
            altText: cachedImages[0].alt_text,
            hideDesktop: banner.hidden_desktop,
            hideMobile: banner.hidden_mobile,
            startDate: startDate ?? null,
            endDate: expiresDate ?? null,
            isChanged: true,
            comments: banner.disclaimer
        };
        bannerData = [{...responseData, ...overrides}];
        await this._editBannerRecord(bannerData);



        return {
            data: bannerData
        };
    }

    async _uploadAllImages(cachedImages) {
        const uploaded = [];

        for (const img of cachedImages) {
            let uploadedUrl = await this.uploadImage(img.blob, img.filename);
            uploaded.push({
                originalUrl: img.url,
                uploadedUrl: uploadedUrl,
                filename: img.filename,
                filetype: img.filetype,
                dimensions: img.dimensions
            });
        }

        return uploaded;
    }

    async _createBannerRecord(bannerData) {
        const endpoint = `https://powertrain.dealeron.com/powertrain/vehiclephotos/${this.dealerId}`; 
        
        const response = await fetch(endpoint, {
            method: "POST",
            credentials: "same-origin",
            headers: {
                "Accept": "*/*",
                "authorization": `Bearer ${this.accessToken}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(bannerData)
        });

        if (!response.ok) {
            throw new Error(`Banner creation failed: ${response.status}`);
        }

        return true;
    }

    async _editBannerRecord(bannerData){
        const endpoint =`https://powertrain.dealeron.com/powertrain/vehiclephotos/${this.dealerId}/update`;

        const response = await fetch(endpoint, {
            method: "POST",
            credentials: "same-origin",
            headers: {
                "Accept": "*/*",
                "authorization": `Bearer ${this.accessToken}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(bannerData)
        });

        if (!response.ok) {
            throw new Error(`Banner creation failed: ${response.status}`);
        }

        return true;
    }

    async _fetchAllBanners(){
        const endpoint = `https://powertrain.dealeron.com/powertrain/vehiclephotos/${this.dealerId}?showExpired=true`;
        const response = await fetch(endpoint, {
            method: "GET",
            credentials: "same-origin",
            headers: {
                "Accept": "*/*",
                "authorization": `Bearer ${this.accessToken}`,
            }
        });
        if(!response.ok){
            throw new Error(`Error fetching existing banners: ${response.status}`);
        }
        return await response.json();
    }
}

    api.DealerOnCMS = DealerOnCMS;
})();
