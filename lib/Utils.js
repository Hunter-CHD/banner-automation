// Shared userscript module. Loaded by Tampermonkey @require.
(function () {
    "use strict";
    const api = globalThis.BannerAutomation ??= {};

class Utils {
    static async fetchElement(url, selector) {
        const response = await fetch(url, {
            method: "GET",
            credentials: "same-origin",
        });

        if (!response.ok) {
            throw new Error(`Request failed: ${response.status} ${response.statusText}`);
        }

        const html = await response.text();
        const doc = new DOMParser().parseFromString(html, "text/html");
        return doc.querySelector(selector) ?? null;
    }

    static dateParts(iso) {
        const date = new Date(iso);
        return {
            year: String(date.getFullYear()), month: String(date.getMonth() + 1).padStart(2, "0"),
            day: String(date.getDate()).padStart(2, "0"), hour: String(date.getHours()).padStart(2, "0"),
            minute: String(date.getMinutes()).padStart(2, "0"), second: String(date.getSeconds()).padStart(2, "0")
        };
    }

    static dateString(iso) {
        const { month, day, year } = this.dateParts(iso);
        return `${month}/${day}/${year}`;
    }
}

    api.Utils = Utils;
})();
