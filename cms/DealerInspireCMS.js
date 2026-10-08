// Shared userscript module. Loaded by Tampermonkey @require.
(function () {
    "use strict";
    const api = globalThis.BannerAutomation ??= {};
    const { Utils, BannerInput } = api;

class DealerInspireCMS {
    constructor() { this.sliders = []; this.currentSlider = null; this.nonce = null; }

    async init() {
        if (!this.initPromise) this.initPromise = this.getSliders().then(sliders => { this.sliders = sliders; });
        return this.initPromise;
    }

    getFields() {
        return [{ key: "slider", label: "Slider", type: "select", placeholder: "Select a slider...",
            optionsAsync: async () => { await this.init(); return this.sliders.map(slider => ({ value: slider.id, label: slider.name })); },
            onChange: value => { this.currentSlider = this.sliders.find(slider => String(slider.id) === String(value)); }
        }];
    }

    async prepareBatch() {
        if (!this.currentSlider) throw new Error("Select a slider before uploading");
        this.nonce = await this.getMediaUploadNonce();
    }

    selectImages(banner) {
        const desktop = BannerInput.primaryImage(banner);
        const mobile = banner.images.find(image => image.media === "mobile") ?? desktop;
        return desktop === mobile ? [desktop] : [desktop, mobile];
    }

    getWarnings(banner) {
        const warnings = BannerInput.commonWarnings(banner);
        if (banner.images.length > this.selectImages(banner).length) warnings.push("DI uses a max of 2 images -- one for desktop and mobile; additional images are ignored.");
        if (banner.links.length > 1) warnings.push("DI uses only the first ordered link.");
        if (new Date(banner.start_date) > new Date()) warnings.push("DI publishes (privately) immediately; scheduling can be done through the post publishing options.");
        return warnings;
    }

    async getMediaUploadNonce() {
        const mediaUploadUrl = "/wp/wp-admin/upload.php";
        const nonceScript = await Utils.fetchElement(mediaUploadUrl, "#wp-plupload-js-extra");

        if (!nonceScript) {
            throw new Error("Could not find the plupload settings script on upload.php");
        }

        const varName = "_wpPluploadSettings";
        const pattern = new RegExp(`var\\s+${varName}\\s*=\\s*([\\s\\S]*?);\\s*(?:\\n|$)`);
        const match = nonceScript.textContent.trim().match(pattern);

        if (!match) {
            throw new Error(`Variable "${varName}" not found in script`);
        }

        let settings;
        try {
            settings = JSON.parse(match[1]);
        } catch (err) {
            throw new Error(`Failed to parse "${varName}" as JSON: ${err.message}`);
        }

        return settings.defaults.multipart_params._wpnonce;
    }

    async getSliders() {
        const resultTable = await Utils.fetchElement("/wp/wp-admin/edit.php?post_type=di_slider", "#the-list");
        if (!resultTable) {
            throw new Error("Unable to fetch list of DI Sliders");
        }

        const sliders = [];
        Array.from(resultTable.querySelectorAll("tr")).forEach((slider) => {
            const tempEntry = {};
            tempEntry.id = slider.id.slice(5);
            tempEntry.name = slider.querySelector(".row-title").innerText;
            sliders.push(tempEntry);
        });
        return sliders;
    }

    async uploadToWordPress(nonce, filename, image, alt) {
        const form = new FormData();
        form.append("name", filename);
        form.append("action", "upload-attachment");
        form.append("_wpnonce", nonce);
        form.append("async-upload", image, filename);
        form.append("_wp_attachment_image_alt", alt);

        const response = await fetch("/wp/wp-admin/async-upload.php", {
            method: "POST",
            credentials: "same-origin",
            body: form,
        });

        if (!response.ok) {
            throw new Error(`Upload failed: HTTP ${response.status}`);
        }

        const data = await response.json();
        if (!data || data.success === false) {
            const message = data?.data?.message || "Unknown upload error";
            throw new Error(`Upload rejected: ${message}`);
        }

        const imgData = data.data;
        return {
            id: imgData.id,
            height: imgData.height,
            width: imgData.width,
            src: imgData.url
        };
    }

    async setImageMeta(image, alt, title){
        let attachmentForm = await Utils.fetchElement(`/wp/wp-admin/post.php?post=${image.id}&action=edit`, "#post");
        if (!attachmentForm) {
            throw new Error('Could not find the "#post" form on the new-post screen.');
        }
        let scraped = Object.fromEntries(new FormData(attachmentForm));
        let overrides = {
            "_wp_attachment_image_alt": alt || "",
            "post_title": title || ""
        };

        const fields = { ...scraped, ...overrides };

        const params = new URLSearchParams();
        for (const [key, value] of Object.entries(fields)) {
            params.append(key, String(value));
        }

        const submitUrl = `/wp/wp-admin/post.php?post=${scraped.post_ID}&action=edit`;
        const response = await fetch(submitUrl, {
            method: "POST",
            credentials: "same-origin",
            headers: {
                "Accept": "application/json, text/javascript, */*; q=0.01",
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            },
            body: params,
        });

        if (!response.ok) {
            throw new Error(`Submit failed: HTTP ${response.status} ${response.statusText}`);
        }

        const finalUrl = response.url;
        if (finalUrl === submitUrl || finalUrl.endsWith(submitUrl)) {
            throw new Error(`Expected redirect but final URL matches submit URL: ${finalUrl}`);
        }
    }

    async fetchAndUploadImage(blob, filename, nonce, altText = '', title = '') {
        let image = await this.uploadToWordPress(nonce, filename, blob, altText);
        await this.setImageMeta(image, altText, title);
        return image;
    }

    // ---------------------------------------------------------------------
    // Banner post creation
    // ---------------------------------------------------------------------

    async uploadBanner(banner, cachedImages) {
        if (!this.currentSlider || !this.nonce) throw new Error("Select a slider before uploading");
        const desktop = cachedImages.find(image => image.media === "desktop") ?? cachedImages[0];
        const mobile = cachedImages.find(image => image.media === "mobile") ?? desktop;
        const desktopAltText = desktop.alt_text;
        const mobileAltText = mobile.alt_text;
        const desktopImage = await this.fetchAndUploadImage(desktop.blob, desktop.filename, this.nonce, desktopAltText, banner.title + " - Desktop");
        const mobileImage = mobile === desktop ? desktopImage : await this.fetchAndUploadImage(mobile.blob, mobile.filename, this.nonce, mobileAltText, banner.title + " - Mobile");
        const expiresDate = Utils.dateParts(banner.end_date);

        const pageUrl = "/wp/wp-admin/post-new.php?post_type=di_slide";
        const pageResponse = await fetch(pageUrl, {
            method: "GET",
            credentials: "same-origin",
        });

        if (!pageResponse.ok) {
            throw new Error(`Failed to load new-post screen: ${pageResponse.status} ${pageResponse.statusText}`);
        }

        const html = await pageResponse.text();
        const doc = new DOMParser().parseFromString(html, "text/html");

        const form = doc.getElementById("post");
        if (!form) {
            throw new Error('Could not find the "#post" form on the new-post screen.');
        }

        const scraped = Object.fromEntries(new FormData(form));

        const overrides = {
            "original_post_status": "auto-draft",
            "referredby": window.location.origin + "/wp/wp-admin/post-new.php?post_type=di_slide",
            "post_status": "publish",
            "publish": "Update",
            "post_title": banner.title,
            "visibility": "private",
            "slide[slider]": this.currentSlider.name,
            "slide[imageSlideType]": "image",

            "slide[desktopImageSrc]": desktopImage.src,
            "slide[desktopImageWidth]": desktopImage.width,
            "slide[desktopImageHeight]": desktopImage.height,
            "slide[desktopImageAlt]": desktopAltText,
            "slide[desktopImageID]": desktopImage.id,

            "slide[mobileImageSrc]": mobileImage.src,
            "slide[mobileImageWidth]": mobileImage.width,
            "slide[mobileImageHeight]": mobileImage.height,
            "slide[mobileImageAlt]": mobileAltText,
            "slide[mobileImageID]": mobileImage.id,

            "slide[slideUrl]": banner.links[0]?.url ?? "",
            "slide[slideUrlTarget]": banner.links[0]?.target ?? "current",
            "slide[disclaimer]": banner.disclaimer ?? "",
            "post_name": banner.title.toLowerCase().replaceAll(' ', '-'),
            "expires_month": String(expiresDate.month),
            "expires_day": String(expiresDate.day),
            "expires_year": String(expiresDate.year),

            "slide[isCTA]": "false",
            "slide[slideLanguage]": "en",
            "slide[videoSlideNext]": "false",
            "slide[videoSlideAudio]": "false",
            "slide[type]": "image",
            "slide[slideVisibility]": "both",
        };
        const fields = { ...scraped, ...overrides };

        const params = new URLSearchParams();
        for (const [key, value] of Object.entries(fields)) {
            params.append(key, String(value));
        }

        const submitUrl = `/wp/wp-admin/post.php?post=${scraped.post_ID}&action=edit`;
        const response = await fetch(submitUrl, {
            method: "POST",
            credentials: "same-origin",
            headers: {
                "Accept": "application/json, text/javascript, */*; q=0.01",
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            },
            body: params,
        });

        if (!response.ok) {
            throw new Error(`Submit failed: HTTP ${response.status} ${response.statusText}`);
        }

        const finalUrl = response.url;
        if (finalUrl === submitUrl || finalUrl.endsWith(submitUrl)) {
            throw new Error(`Expected redirect but final URL matches submit URL: ${finalUrl}`);
        }

        return { success: true, postId: scraped.post_ID, finalUrl };
    }
}

    api.DealerInspireCMS = DealerInspireCMS;
})();
