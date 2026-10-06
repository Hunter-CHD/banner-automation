// ==UserScript==
// @name         Dealer.com Banner Uploader
// @namespace    http://tampermonkey.net/
// @version      2.0.0
// @description  Multiple banner uploads with progress tracking
// @author       Hunter Adams
// @match        *://apps.dealercenter.coxautoinc.com/promotions/manager/*
// @icon         https://portal.clickheredigital.com/favicon.ico
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        unsafeWindow
// @run-at       document-idle
// @connect      *
// @require      https://raw.githubusercontent.com/YOUR_GITHUB_OWNER/YOUR_REPOSITORY/main/lib/EventBus.js
// @require      https://raw.githubusercontent.com/YOUR_GITHUB_OWNER/YOUR_REPOSITORY/main/lib/Utils.js
// @require      https://raw.githubusercontent.com/YOUR_GITHUB_OWNER/YOUR_REPOSITORY/main/lib/BannerInput.js
// @require      https://raw.githubusercontent.com/YOUR_GITHUB_OWNER/YOUR_REPOSITORY/main/lib/BannerImage.js
// @require      https://raw.githubusercontent.com/YOUR_GITHUB_OWNER/YOUR_REPOSITORY/main/lib/ImageManager.js
// @require      https://raw.githubusercontent.com/YOUR_GITHUB_OWNER/YOUR_REPOSITORY/main/lib/UIManager.js
// @require      https://raw.githubusercontent.com/YOUR_GITHUB_OWNER/YOUR_REPOSITORY/main/cms/DealerDotComCMS.js
// ==/UserScript==

(async function () {
    "use strict";
    const { EventBus, ImageManager, UIManager, DealerDotComCMS } = globalThis.BannerAutomation;
    try {
        const cms = await DealerDotComCMS.waitForContext();
        new UIManager(new EventBus(), cms, new ImageManager(), { preBannerFields: cms.getFields() }).init();
    } catch (error) {
        console.error("Banner uploader initialization failed:", error);
    }
})();
