// ==UserScript==
// @name         DI Banner Uploader
// @namespace    http://tampermonkey.net/
// @version      2.0.0
// @description  Multiple banner uploads with progress tracking
// @author       Hunter Adams
// @match        *://*/wp/wp-admin/edit.php*
// @icon         https://portal.clickheredigital.com/favicon.ico
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @connect      *
// @run-at       document-idle
// @require      https://raw.githubusercontent.com/Hunter-CHD/banner-automation/main/lib/EventBus.js
// @require      https://raw.githubusercontent.com/Hunter-CHD/banner-automation/main/lib/Utils.js
// @require      https://raw.githubusercontent.com/Hunter-CHD/banner-automation/main/lib/BannerInput.js
// @require      https://raw.githubusercontent.com/Hunter-CHD/banner-automation/main/lib/BannerImage.js
// @require      https://raw.githubusercontent.com/Hunter-CHD/banner-automation/main/lib/ImageManager.js
// @require      https://raw.githubusercontent.com/Hunter-CHD/banner-automation/main/lib/UIManager.js
// @require      https://raw.githubusercontent.com/Hunter-CHD/banner-automation/main/cms/DealerInspireCMS.js
// ==/UserScript==

(async function () {
    "use strict";
    if (new URLSearchParams(location.search).get("post_type") !== "di_slide") return;
    const { EventBus, ImageManager, UIManager, DealerInspireCMS } = globalThis.BannerAutomation;
    try {
        const cms = new DealerInspireCMS();
        const ui = new UIManager(new EventBus(), cms, new ImageManager(), {
            preBannerFields: cms.getFields?.() ?? []
        });
        ui.init();
    } catch (error) {
        console.error("Banner uploader initialization failed:", error);
    }
})();
