(function () {
    "use strict";
    const api = globalThis.BannerAutomation ??= {};
    const { BannerInput } = api;
    const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

class DealerDotComCMS{
    static async waitForContext(timeout = 30000) {
        const deadline = Date.now() + timeout;
        while (Date.now() < deadline) {
            if (unsafeWindow.ddc?.global?.account?.accountId && unsafeWindow.ddc?.global?.actualUser?.userId) return new DealerDotComCMS();
            await new Promise(resolve => setTimeout(resolve, 250));
        }
        throw new Error("Dealer.com account context did not become available");
    }

    constructor(){
        this.accountId = unsafeWindow.ddc.global.account.accountId;
        this.userId = unsafeWindow.ddc.global.actualUser.userId;

        this.mediaRoot = null;
        this.promotionType = "AUTO";
        // Supported destinations from the original uploader, keyed by ratio and device.
        this.placementTypes = {
            tall_horizontal: {
                desktop: ["slide"]
            },
            short_horizontal: {
                desktop: ["slide", "srp"]
            },
            tall_vertical: {
                desktop: ["srp"],
                mobile: ["srp"]
            },
            short_vertical: {
                desktop: ["coupon"],
                mobile: ["coupon", "srp"]
            }
        };
    }

    async init() {
        if (!this.initPromise) this.initPromise = this.getMediaRoot().then(root => { this.mediaRoot = root; });
        return this.initPromise;
    }

    getFields() {
        return [{ key: "promotionType", type: "select", label: "Promotion type", value: "AUTO",
            options: ["AUTO", "VEHICLE", "EVENT", "SERVICE", "PARTS", "INCENTIVE"].map(value => ({ value, label: value === "AUTO" ? "Automatic (vehicle info → Vehicle; otherwise Event)" : value })),
            onChange: value => { this.promotionType = value; }
        }];
    }

    getType(banner) {
        return this.promotionType === "AUTO" ? (banner.vehicle && Object.values(banner.vehicle).some(value => value !== "") ? "VEHICLE" : "EVENT") : this.promotionType;
    }

    getWarnings(banner) {
        const warnings = ["The current Dealer.com request does not send image alt text."];
        if (banner.links.length > 2) warnings.push("Dealer.com uses the first two ordered links.");
        const type = this.getType(banner);
        if (type === "VEHICLE" && (banner.vehicle?.year || banner.vehicle?.trim)) warnings.push("Dealer.com vehicle targeting currently uses make and model only.");
        if (type === "INCENTIVE") warnings.push("Incentive uploads set year and make only; select the incentive and vehicle image in the CMS afterward.");
        if (banner.vehicle && !["VEHICLE", "INCENTIVE"].includes(type)) warnings.push("Vehicle info is not applied to this promotion type.");
        if (banner.hidden_desktop || banner.hidden_mobile) warnings.push("Device visibility flags apply only to DealerOn; Dealer.com placements follow each image's media value.");
        return warnings;
    }

    static detectPlacementType(width, height) {
        if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
        const ratio = width / height;
        return Object.entries({ tall_horizontal: 4, short_horizontal: 10, tall_vertical: 9 / 16, short_vertical: 4 / 3 })
            .find(([, expected]) => Math.abs(ratio - expected) < 0.2)?.[0] ?? null;
    }

    prepareImages(images) {
        const assets = new Map();
        return images.map(image => {
            const placement = DealerDotComCMS.detectPlacementType(image.dimensions.width, image.dimensions.height);
            if (!placement) throw new Error(`${image.filename}: unsupported aspect ratio; use 4:1, 10:1, 9:16, or 4:3`);
            const destinations = this.placementTypes[placement]?.[image.media];
            if (!destinations) throw new Error(`${image.filename}: ${placement.replaceAll("_", " ")} has no supported ${image.media} placements`);
            if (assets.has(placement) && assets.get(placement) !== image.url) throw new Error(`Dealer.com allows only one asset for ${placement}; use different aspect ratios for different images`);
            assets.set(placement, image.url);
            return { ...image, placement, destinations };
        });
    }

    describeImages(images) {
        const labels = { slide: "Slide", srp: "SRP", coupon: "Coupon" };
        return this.prepareImages(images).map(image =>
            `${image.filename} (${image.dimensions.width} × ${image.dimensions.height}): ${image.placement.replaceAll("_", " ")} → ${image.media} ${image.destinations.map(destination => labels[destination]).join(", ")}`
        ).join("\n");
    }

    async getMediaRoot(){
        let folderList = await fetch(`/medialibrary-services/client/media/getFolders?accountId=${this.accountId}&userId=${this.userId}`)
            .then((response) => {
                if(!response.ok){
                    throw new Error(`Unable to fetch account folders: ${response.status}`);
                }
                return response.json();
            });
        return folderList.value;
    }

    async uploadImage(image, filename = "placeholder.jpg"){
        let ulid = DealerDotComCMS.ulid();

        let uploadURL = await this.preflightUpload(ulid, image, filename);
        let uploadedImage = await this.postImage(ulid, uploadURL, image, filename);

        // retry loop
        let maxRetries = 10;
        let retryDelay = 1000; // ms
        let uploadPoll = {status:"UPLOADING"};

        for(let retries = 0; retries < maxRetries; retries++){
            uploadPoll = await fetch(`/medialibrary-services/client/write/uploads?accountId=${this.accountId}&userId=${this.accountId}-admin`,{
                method: "POST",
                credentials: "same-origin",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    accountId: this.accountId,
                    createdBy: this.userId,
                    destinationFolder: this.mediaRoot,
                    fileSize: image.size || 1,
                    originalFileName: filename,
                    routingKey: "MARS",
                    uploadId: ulid,
                })
            })
            .then((response) => {
                if(!response.ok){
                    throw new Error(`Upload polling retry failed: ${response.status}`);
                }
                else{
                    return response.json();
                }
            });

            if(uploadPoll.status !== "UPLOADED"){
                await new Promise(resolve => setTimeout(resolve, retryDelay));
            }
            else {
                break;
            }
        }

        if(uploadPoll.status !== "UPLOADED"){
            throw new Error(`Upload failed after ${maxRetries} retries. Status: ${uploadPoll.status}`);
        }

        return uploadPoll.assetInfo.name;
    }

    async preflightUpload(ulid, image,filename = "placeholder.jpg"){

        let preflightData = {
            routingKey: "web",
            accountId: this.accountId,
            uploadGroupId: ulid,
            assetInfo: {
                asset: {
                    libraryId: this.mediaRoot,
                    filename: filename,
                    contentType: image.type || "image/jpeg",
                    shouldResize: false,
                    pdfConvertToPng: false,
                }
            },
        };

        let uploadURL = await fetch("/media-asset-routing-system/presignedUrlV2", {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(preflightData)
        })
            .then((response) => {
                if(!response.ok){
                    throw new Error("Presigned upload URL fetching failed: " + response.status);
                }
                return response.json();
            })
        return uploadURL.urls[0].url;
    }

    async postImage(ulid, uploadURL, image, filename = "placeholder.jpg"){
        let uploadedImage = await fetch(uploadURL, {
            method: "PUT",
            credentials: "same-origin",
            headers: {
                "x-amz-meta-routingkey": "web",
                "x-amz-meta-accountid": this.accountId,
                "x-amz-meta-createdby": this.userId,
                "x-amz-meta-uploadid": "asset",
                "x-amz-meta-filename": filename,
                "x-amz-meta-contenttype": image.type,
                "x-amz-meta-uploadgroupid": ulid,
                "x-amz-meta-libraryid": this.mediaRoot,
                "x-amz-meta-shouldresize": "false",
                "x-amz-meta-pdfconverttopng": "false",
            },
            body: image
        })
        .then((response) => {
            if(!response.ok){
                throw new Error("Presigned upload URL fetching failed: " + response.status);
            }
        });
        return uploadedImage;
    }

    async uploadBanner(banner, cachedImages = []){
        const prepared = this.prepareImages(cachedImages);
        if (!prepared.length) throw new Error("No images prepared for upload");
        await this.init();
        const uploadedImages = [];
        const uploadedUrls = new Map();
        for (const image of prepared) {
            if (!uploadedUrls.has(image.url)) uploadedUrls.set(image.url, await this.uploadImage(image.blob, image.filename));
            uploadedImages.push({ ...image, cmsUrl: uploadedUrls.get(image.url) });
        }
        const [primary, secondary] = banner.links;
        const cta = link => link ? { type: /^https?:\/\//i.test(link.url) || link.url.startsWith("//") ? "EXTERNAL" : "INTERNAL", openInNewTab: link.target === "new", dynamicParams: null } : null;

        let bannerData = {
            accountId: this.accountId,
            enabledAppleWallet: false,
            createdBy: this.userId,
            lastUpdatedBy: this.userId,
            lastUpdated: new Date().toISOString(),
            startDate: new Date(banner.start_date).getTime(),
            startDateDisplay: "NO_SHOW_ON_SPECIAL",
            endDate: new Date(banner.end_date).getTime(),
            endDateDisplay: "NO_SHOW_ON_SPECIAL",

            defaultLocale: "en_US",

            destinationLabel: primary ? "Learn More" : null,
            destinationUrl: primary?.url ?? null,
            ctaConfig: cta(primary),

            secondaryDestinationLabel: secondary ? "Learn More" : null,
            secondaryDestinationUrl: secondary?.url ?? null,
            secondaryCtaConfig: cta(secondary),

            i18n: {
                en_US: {
                    title: banner.title,
                    description: banner.description,
                    disclaimer: banner.disclaimer || "",
                }
            },

            placement: { en_us: {} },
            tags: [],
            type: this.getType(banner),
            emphasizedType: "DESCRIPTION",

            metadata: {
                visibleByDefault: true,
                tracking: {
                    recordId: ""
                }
            }
        };

        // Start with all destinations disabled for this banner, then enable detected ones.
        const placementData = {};
        for (const [placementType, devices] of Object.entries(this.placementTypes)) {
            placementData[placementType] = {
                customAsset: "",
                customAssetVideo: "",
                enabled: false,
                ...Object.fromEntries(Object.entries(devices).map(([device, destinations]) => [device, Object.fromEntries(destinations.map(destination => [destination, false]))]))
            };
        }

        // assign uploaded images to their placements and enable them
        uploadedImages.forEach((img) => {
            if (img.placement && placementData[img.placement]) {
                placementData[img.placement].customAsset = img.cmsUrl;
                placementData[img.placement].enabled = true;
                placementData[img.placement][img.media] = Object.fromEntries(img.destinations.map(destination => [destination, true]));
            }
        });

        bannerData.placement.en_us = placementData;

        // per type additional info
        switch(bannerData.type){
            case "VEHICLE":
                // has too many options, only implmenting "MAKE_MODEL_TRIM"
                let ruleRow = [];
                ruleRow.push({
                    "field": "CONDITION",
                    "operator": "eq",
                    "value": "new"
                });
                if(banner.vehicle?.make){
                    ruleRow.push({
                        "field": "MAKE",
                        "operator": "eq",
                        "value": banner.vehicle.make
                    });
                }
                if(banner.vehicle?.model){
                    ruleRow.push({
                        "field": "MODEL",
                        "operator": "eq",
                        "value": banner.vehicle.model
                    });
                }
                bannerData.rules = [ruleRow];
                break;
            case "INCENTIVE":
                bannerData.applicableCondition = "NEW";
                bannerData.year = banner.vehicle?.year ?? new Date().getFullYear();
                bannerData.make = banner.vehicle?.make ?? "";
                bannerData.applicableMake = bannerData.make;
                break;
            // service and parts use the same fields
            // defaulting to no discount during testing
            case "SERVICE":
            case "PARTS":
                bannerData.couponCode = "";
                bannerData.discountType = "NO_DISCOUNT";
                bannerData.discountValue = "0";
                break;
            // no additional fields needed for event banners, that I know of
            case "EVENT":
                break;
            default:

        }

        let stringifiedData = JSON.stringify(bannerData);
        let uploadedBanner = await fetch("/promotions/promotions-manager/api/v2/promotions", {
            method: "POST",
            credentials: "same-origin",
            headers: {
                "Accept": "application/vnd.dealer.promotion.v4+json",
                "Content-Type": "application/json",
            },
            body: stringifiedData
        })
        .then((response) => {
            if(!response.ok){
                throw new Error("Banner POST failed: " + response.status);
            }
            return response.json();
        });
        return {
            data: bannerData,
            response: uploadedBanner
        };
    }

    static encodeTime(now, len) {
        let str = "";
        for (; len > 0; len--) {
            const mod = now % ENCODING.length;
            str = ENCODING.charAt(mod) + str;
            now = (now - mod) / ENCODING.length;
        }
        return str;
    }

    static encodeRandom(len) {
        let str = "";
        for (; len > 0; len--) {
            str += ENCODING.charAt(Math.floor(Math.random() * ENCODING.length));
        }
        return str;
    }

    static ulid() {
        return DealerDotComCMS.encodeTime(Date.now(), 10) + DealerDotComCMS.encodeRandom(16);
    }
}


    api.DealerDotComCMS = DealerDotComCMS;
})();
