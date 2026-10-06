// ==UserScript==
// @name         DealerOn Banner Uploader
// @namespace    http://tampermonkey.net/
// @version      2.0.0
// @description  Multiple banner uploads with progress tracking
// @author       Hunter Adams
// @match        *://gallery.dealeron.com/*
// @match        *://cms.dealeron.com/dash/dist/cms/*
// @icon         https://portal.clickheredigital.com/favicon.ico
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        unsafeWindow
// @connect      *
// @run-at       document-idle
// @require      https://raw.githubusercontent.com/Hunter-CHD/banner-automation/main/lib/EventBus.js
// @require      https://raw.githubusercontent.com/Hunter-CHD/banner-automation/main/lib/Utils.js
// @require      https://raw.githubusercontent.com/Hunter-CHD/banner-automation/main/lib/BannerInput.js
// @require      https://raw.githubusercontent.com/Hunter-CHD/banner-automation/main/lib/BannerImage.js
// @require      https://raw.githubusercontent.com/Hunter-CHD/banner-automation/main/lib/ImageManager.js
// @require      https://raw.githubusercontent.com/Hunter-CHD/banner-automation/main/lib/UIManager.js
// @require      https://raw.githubusercontent.com/Hunter-CHD/banner-automation/main/cms/DealerOnCMS.js
// ==/UserScript==

(async function () {
    "use strict";
    const { EventBus, ImageManager, UIManager, DealerOnCMS } = globalThis.BannerAutomation;
    try {
        const cms = await DealerOnCMS.waitForContext();
        const ui = new UIManager(new EventBus(), cms, new ImageManager(), {
            preBannerFields: cms.getFields?.() ?? []
        });
        ui.init();
    } catch (error) {
        console.error("Banner uploader initialization failed:", error);
    }
})();
