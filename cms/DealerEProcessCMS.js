// Shared userscript module. Loaded by Tampermonkey @require.
(function () {
    "use strict";
    const api = globalThis.BannerAutomation ??= {};
    const { Utils, BannerInput } = api;

class DealerEProcessCMS {
    constructor() {
        this.siteId = document.getElementById("current_site_id")?.value;
        if (!this.siteId) {
            throw new Error("Unable to find site ID, aborting");
        }

        this.adCampaigns = [];
        this.currentCampaign = null;
        this.originalSerializedAds = null;
        this._initPromise = null;
    }

    getFields() {
        return [{ key: "adCampaign", label: "Ad Campaign", type: "select", placeholder: "Select a campaign...",
            optionsAsync: async () => { await this.init(); return this.adCampaigns.map(c => ({ value: c.id, label: c.name })); },
            onChange: value => { this.currentCampaign = value; }
        }];
    }

    async prepareBatch() {
        await this.init();
        if (!this.adCampaigns.some(c => String(c.id) === String(this.currentCampaign))) throw new Error("Select an ad campaign before uploading");
    }

    selectImages(banner) { return [BannerInput.primaryImage(banner)]; }

    getWarnings(banner) {
        const warnings = BannerInput.commonWarnings(banner);
        if (banner.images.length > 1) warnings.push("Dealer E-Process uses the first desktop image (or the first image if none is desktop).");
        if (banner.links.length > 1) warnings.push("Dealer E-Process uses only the first ordered link.");
        if (banner.links[0]?.target === "new") warnings.push("The Dealer E-Process request does not support a new-tab target.");
        if (banner.hidden_desktop || banner.hidden_mobile) warnings.push("Device visibility flags apply only to DealerOn.");
        warnings.push("Dealer E-Process schedules calendar dates only, using the browser's timezone.");
        return warnings;
    }

    // Safe to call multiple times - all callers share the same in-flight
    // (or resolved) promise instead of re-fetching campaigns each time.
    async init() {
        if (this._initPromise) return this._initPromise;

        this._initPromise = (async () => {
            this.adCampaigns = await this.getAdCampaignList();
            console.log(`DealerEProcessCMS initialized with ${this.adCampaigns.length} campaign(s)`);
        })();

        return this._initPromise;
    }

    async finishUpload(uploadedBanners){
        if (!this.currentCampaign) {
            throw new Error("No campaign selected");
        }

        const campaign = this.adCampaigns.find(c => c.id === this.currentCampaign);
        if (!campaign) {
            throw new Error("Selected campaign not found");
        }

        // 1. Get current ad campaign and save serialized ads as backup
        console.log("Fetching current campaign state...");
        const campaignData = await this.getAdCampaign(campaign);
        this.originalSerializedAds = JSON.parse(JSON.stringify(campaignData.serializedAds));
        console.log("Original ads backed up:", this.originalSerializedAds);

        // 2. Wait for all banner uploads (already done by caller, just process results)
        const newAds = [];
        for (const uploaded of uploadedBanners) {
            if (uploaded.result?.success && uploaded.result?.result) {
                newAds.push(uploaded.result.result);
            }
        }

        if (newAds.length === 0) {
            throw new Error("No banners were successfully uploaded");
        }

        // Find the highest sort value in existing ads
        const maxSort = this.originalSerializedAds.ads.length > 0
            ? Math.max(...this.originalSerializedAds.ads.map(a => a.sort || 1))
            : 1;

        // Assign incremental sort values to new ads
        newAds.forEach((ad, index) => {
            ad.sort = maxSort + index + 1;
        });

        // 3. Append newly returned objects to a copy of saved serialized ads
        const updatedAds = {
            ...this.originalSerializedAds,
            ads: [...this.originalSerializedAds.ads, ...newAds]
        };
        console.log("Updated ads list:", updatedAds);

        // 4. Run saveChanges
        console.log("Saving changes...");
        await this.saveChanges(campaign, updatedAds);

        // 5. Verify by calling getAdCampaign again
        console.log("Verifying changes...");
        const verifyData = await this.getAdCampaign(campaign);
        
        // Compare the ads we sent with what came back
        const sentAdIds = updatedAds.ads.map(a => a.ad_id).sort();
        const receivedAdIds = verifyData.serializedAds.ads.map(a => a.ad_id).sort();
        
        const idsMatch = JSON.stringify(sentAdIds) === JSON.stringify(receivedAdIds);

        // 6. If verification fails, rollback
        if (!idsMatch) {
            console.error("Verification failed! Rolling back...");
            console.error("Sent IDs:", sentAdIds);
            console.error("Received IDs:", receivedAdIds);
            
            await this.saveChanges(campaign, this.originalSerializedAds);
            throw new Error("Verification failed - changes rolled back");
        }

        console.log("Upload and verification successful!");
        return {
            success: true,
            addedCount: newAds.length,
            totalCount: verifyData.serializedAds.ads.length
        };
    }

    async uploadImage(imageBlob, filename = "placeholder.jpg") {
        let initImageUpload = new FormData();
        initImageUpload.append("image", imageBlob, filename);
        initImageUpload.append("fnc", "browse-upload");

        let response = await fetch(`/site-${this.siteId}/image-add/folder=1`, {
            method: "POST",
            credentials: "same-origin",
            headers: {
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
            },
            body: initImageUpload
        });

        if (!response.ok) {
            throw new Error(`Image Upload (Step 1/3) Failed: ${response.status} ${response.statusText}`);
        }

        let html = await response.text();
        let doc = new DOMParser().parseFromString(html, "text/html");
        let uploadId = doc.querySelector(`#image_add [name="upload_id"]`) ?? null;
        if(!uploadId?.value){
            throw new Error(`Error occured parsing image upload ID from image add page`);
        }
        uploadId = uploadId.value;

        let confirmUpload = new FormData();
        confirmUpload.append("filename", filename);
        confirmUpload.append("upload_id", uploadId);
        confirmUpload.append("fnc", "crop-save");

        let confirm = await fetch(`/site-${this.siteId}/image-add/folder=1`, {
            method: "POST",
            credentials: "same-origin",
            headers: {
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
            },
            body: confirmUpload
        });
        if (!confirm.ok) {
            throw new Error(`Image Upload (Step 2/3) Failed: ${response.status} ${response.statusText}`);
        }
        let messagePage = await confirm.text();
        let messageDoc = new DOMParser().parseFromString(messagePage, "text/html");
        let imageId = messageDoc.querySelector("#image_add script");
        if(!imageId){
            throw new Error(`Image Upload (Step 3/3) Failed: Unable to find postMessage script`);
        }
        let matchIdRegex = /id: '([0-9]+)'/;
        imageId = imageId.innerHTML.match(matchIdRegex);
        if(!imageId?.[1]){
            throw new Error(`Image Upload (Step 3/3) Failed: No regex match found for image ID`);
        }
        console.log(imageId[1]);
        return imageId[1];
    }

    async uploadBanner(banner, cachedImages = []) {
        await this.prepareBatch();
        let bannerImage = cachedImages[0];
        if (!bannerImage) throw new Error("No image prepared for upload");
        let imageId = await this.uploadImage(bannerImage.blob, bannerImage.filename);
        const startDate = Utils.dateString(banner.start_date);
        const endDate = Utils.dateString(banner.end_date);

        let bannerData = {
            banner_type: "1", //1->sales, 2->service, 3->parts, 4->finance
            ad_veh_tags: "{}",
            ad_year_tags: "[]",
            ad_alt: bannerImage.alt_text,
            ad_title: banner.title,
            ad_img_id: imageId,
            ad_vid_id: "",
            ad_share: false,            
            ad_keywords: "[]",
            disc_flag: true,
            disc_loc: "3",
            disc_color: "1",
            disc_link: "",
            disc_text: banner.disclaimer,
            disc_html_flag: false,
            adv_action: !banner.links[0] ? "1" : (banner.links[0].target == "current" ? "2" : "3"), // 1->do nothing, 2->open link in current tab, 3->open link in new tab
            adv_url: banner.links[0]?.url ?? "",
            date_from: startDate,
            date_to: endDate,
            date_action: "1",
            vehicle_filter: false,
            vehicle_priority: false,
            vehicle_strict_filter: false,
            ad_id: 0,
            site_id: this.siteId,
            height: bannerImage.dimensions.height,
            width: bannerImage.dimensions.width,
            flag_active: 1
        };
        const wrapperData = new URLSearchParams();

        wrapperData.append("action", "save");
        wrapperData.append("payload", JSON.stringify(bannerData));
        wrapperData.append("target[]", "Ad");
        wrapperData.append("target[]", "Edit");

        let response = await fetch(`/req/site-${this.siteId}/dashboard/utility/dashpageloader/ajaxProcess/ajax/`, {
            method: "POST",
            credentials: "same-origin",
            headers: {
                "Accept": "application/json, text/javascript, */*; q=0.01",
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"
            },
            body: wrapperData
        });

        if (!response.ok) {
            throw new Error(`Banner creation failed: ${response.status}`);
        }

        response = await response.json();

        if (response.status != 3) {
            throw new Error(`Banner creation failed: ${response.message ?? "No error message provided by server"}`);
        }

        return {
            ad_id: response.payload.ad_id,
            flag_active:true,
            flag_default: false,
            flag_manufacturer: false,
            expiration: endDate,
            sort: 99
        };
    }

    async getAdCampaign(campaign) {
        const formData = new FormData();

        formData.append("action", "get_edit");
        formData.append("payload", JSON.stringify({
            campaign_id: campaign.id,
            inc_settings: true
        }));
        formData.append("target[]", "AdCampaign");
        formData.append("target[]", "Edit");

        let response = await fetch(`/req/site-${this.siteId}/dashboard/utility/dashpageloader/ajaxProcess/ajax/`, {
            method: "POST",
            credentials: "same-origin",
            headers: {
                "Accept": "application/json, text/javascript, */*; q=0.01"
            },
            body: formData
        });

        if (!response.ok) {
            throw new Error(`Ad Campaign config failed: ${response.status}`);
        }

        response = await response.json();

        if (response.status != 3) {
            throw new Error(`Ad Campaign config failed: ${response.message ?? "No error message provided by server"}`);
        }
        if(!response?.payload?.html){
            throw new Error(`Unexpected server response when fetching Ad Campaign`);
        }
        this.currentCampaign = campaign.id;

        let html = `<div id="chd-wrapper">` + response.payload.html + `</div>`;
        let doc = new DOMParser().parseFromString(html, "text/html");
        let responseRoot = doc.querySelector("#chd-wrapper") ?? null;
        let adList = this.serializeAds(responseRoot);

        return {
            id: campaign.id,
            serializedAds: adList,

        }
    }

    serializeAds(parentElement){
        let data = {
            ads: [],
            position: 0,
            frequency: 0
        };

        Array.from(parentElement.querySelectorAll(".c-ad-item")).forEach((ad, index) => {
            if(ad.classList.contains("draggable--original") || ad.classList.contains("draggable-mirror")){
                return;
            }

            data.ads.push({
                ad_id: parseInt(ad.dataset["ad_id"]),
                flag_active: !ad.querySelector(".c-ad-item__image-wrap").classList.contains("js-inactive"),
                flag_default: !ad.querySelector(".js-not-default"),
                flag_manufacturer: ad.classList.contains("c-ad-item--oem"),
                expiration: ad.querySelector(".c-ad-item__expiration_date input").value,
                sort: index + 1,
            });
        });

        data.position = parentElement.querySelector(`.c-adcampaign-ad-manage-page__tagging_controls-wrap .c-select-box__select[name="position_select"]`).value;
        data.frequency = parentElement.querySelector(`.c-adcampaign-ad-manage-page__tagging_controls-wrap .c-select-box__select[name="frequency_select"]`).value;

        return data;
    }

    async saveChanges(campaign, ads){
        let payload = new URLSearchParams();

        ads.site_id = this.siteId;
        ads.campaign_id = this.currentCampaign;

        payload.append("action", "save");
        payload.append("payload", JSON.stringify(ads));
        payload.append("target[]", "AdCampaign");
        payload.append("target[]", "Edit");

        let response = await fetch(`/req/site-${this.siteId}/dashboard/utility/dashpageloader/ajaxProcess/ajax/`, {
            method: "POST",
            credentials: "same-origin",
            headers: {
                "Accept": "application/json, text/javascript, */*; q=0.01"
            },
            body: payload
        });
        if (!response.ok) throw new Error(`Campaign save failed: HTTP ${response.status}`);
        const result = await response.json();
        if (result.status != 3) throw new Error(`Campaign save failed: ${result.message ?? "Unknown server error"}`);
    }

    async getAdCampaignList(){

        let campaignContainer = null;

        // if we're running from somewhere other than the campaign manager, we need to fetch it
        let adCampaignRegex = /dashboard\.dealereprocess\.com\/site-[0-9]+\/ad-campaign-manage-beta\/?/g;
        if(!unsafeWindow.location.href.match(adCampaignRegex)){
            campaignContainer = await Utils.fetchElement(`/site-${this.siteId}/ad-campaign-manage-beta/`, ".c-adcampaign-manage-page .c-cont-head-linked__inner-pop");
        }
        else{
            campaignContainer = document.querySelector(".c-adcampaign-manage-page .c-cont-head-linked__inner-pop");
        }
        
        if(!campaignContainer){
            throw new Error("Error: Unable to get list of ad campaigns");
        }

        let campaigns = [];
        Array.from(campaignContainer.querySelectorAll(".c-adcampaign-item")).forEach((item) => {
            let temp = {};
            temp.id = item.dataset.campaign_id;
            temp.name = item.querySelector(".c-adcampaign-item__title").innerText;
            campaigns.push(temp);
        });
        return campaigns;
    }
}

    api.DealerEProcessCMS = DealerEProcessCMS;
})();
