// Canonical input contract shared by every CMS adapter.
(function () {
    "use strict";
    const api = globalThis.BannerAutomation ??= {};

    class BannerInput {
        // Accept pasted JSON, with optional JSONC comments and trailing commas.
        // Preserve quoted URLs/text when removing that optional syntax.
        static parse(text) {
            let clean = "", quoted = false, escaped = false;
            for (let i = 0; i < text.length; i++) {
                const c = text[i], next = text[i + 1];
                if (quoted) {
                    clean += c;
                    if (escaped) escaped = false;
                    else if (c === "\\") escaped = true;
                    else if (c === '"') quoted = false;
                } else if (c === '"') {
                    quoted = true;
                    clean += c;
                } else if (c === "/" && next === "/") {
                    while (i < text.length && text[i] !== "\n") i++;
                    clean += "\n";
                } else if (c === "/" && next === "*") {
                    const end = text.indexOf("*/", i + 2);
                    if (end < 0) throw new Error("Unterminated JSONC comment");
                    clean += text.slice(i, end + 2).replace(/[^\n\r]/g, " ");
                    i = end + 1;
                } else clean += c;
            }
            let json = "";
            quoted = false;
            escaped = false;
            for (let i = 0; i < clean.length; i++) {
                const c = clean[i];
                if (quoted) {
                    json += c;
                    if (escaped) escaped = false;
                    else if (c === "\\") escaped = true;
                    else if (c === '"') quoted = false;
                } else if (c === '"') {
                    quoted = true;
                    json += c;
                } else if (c !== "," || !/^\s*[}\]]/.test(clean.slice(i + 1))) json += c;
            }
            return JSON.parse(json);
        }

        static date(value, field) {
            // Date-only and timezone-less ISO values use the browser's local time.
            const match = typeof value === "string" && value.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})?)?$/);
            if (!match) throw new Error(`${field} must be an ISO 8601 date or date-time`);
            const [, y, m, d, h = "00", min = "00", s = "00", ms = "0", zone] = match;
            const parts = [+y, +m, +d, +h, +min, +s];
            const calendar = new Date(0);
            calendar.setUTCFullYear(+y, +m - 1, +d);
            calendar.setUTCHours(+h, +min, +s, Number(ms.padEnd(3, "0")));
            const actual = [calendar.getUTCFullYear(), calendar.getUTCMonth() + 1, calendar.getUTCDate(), calendar.getUTCHours(), calendar.getUTCMinutes(), calendar.getUTCSeconds()];
            if (parts.some((part, i) => part !== actual[i])) throw new Error(`${field} is not a valid calendar date`);
            if (zone && zone !== "Z" && (+zone.slice(1, 3) > 23 || +zone.slice(4) > 59)) throw new Error(`${field} has an invalid timezone offset`);
            let date;
            if (zone) date = new Date(value);
            else {
                date = new Date(0);
                date.setFullYear(+y, +m - 1, +d);
                date.setHours(+h, +min, +s, Number(ms.padEnd(3, "0")));
            }
            if (!Number.isFinite(date.getTime())) throw new Error(`${field} is not a valid date`);
            return date;
        }

        static normalize(input, now = new Date()) {
            const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
            if (!object(input)) throw new Error("Each banner must be a JSON object");
            const errors = [];
            const requiredString = (value, path) => {
                if (typeof value !== "string" || !value.trim()) errors.push(`${path} must be a nonempty string`);
            };
            requiredString(input.title, "title");
            requiredString(input.disclaimer, "disclaimer");
            if (input.description !== undefined && typeof input.description !== "string") errors.push("description must be a string");
            let start, end;
            try { start = input.start_date === undefined || input.start_date === "" ? new Date(now) : this.date(input.start_date, "start_date"); } catch (error) { errors.push(error.message); }
            try { end = this.date(input.end_date, "end_date"); } catch (error) { errors.push(error.message); }
            if (start && end && end < start) errors.push("end_date must not precede start_date");
            if (!Array.isArray(input.images) || input.images.length < 1 || input.images.length > 4) errors.push("images must contain 1–4 image objects");
            const images = Array.isArray(input.images) ? input.images.map((image, i) => {
                const path = `images[${i}]`;
                if (!object(image)) { errors.push(`${path} must be an object`); return image; }
                for (const field of ["url", "alt_text", "filename"]) requiredString(image[field], `${path}.${field}`);
                try { if (!["http:", "https:"].includes(new URL(image.url).protocol)) throw new Error(); } catch { errors.push(`${path}.url must be an absolute HTTP(S) URL`); }
                if (typeof image.filename === "string" && (!/\.[a-zA-Z0-9]+$/.test(image.filename) || /[\\/\x00-\x1f]/.test(image.filename))) errors.push(`${path}.filename must be a filename with an extension, without a directory`);
                if (!["desktop", "mobile"].includes(image.media)) errors.push(`${path}.media must be desktop or mobile`);
                return { url: image.url, alt_text: image.alt_text, filename: image.filename, media: image.media };
            }) : [];
            if (!Array.isArray(input.links)) errors.push("links must be an array (it may be empty)");
            const links = Array.isArray(input.links) ? input.links.map((link, i) => {
                const path = `links[${i}]`;
                if (!object(link)) { errors.push(`${path} must be an object`); return link; }
                requiredString(link.url, `${path}.url`);
                try { if (!["http:", "https:"].includes(new URL(link.url, "https://example.invalid/").protocol)) throw new Error(); } catch { errors.push(`${path}.url must be an HTTP(S) or relative URL`); }
                if (link.target !== undefined && !["current", "new"].includes(link.target)) errors.push(`${path}.target must be current or new`);
                if (link.order !== undefined && !Number.isInteger(link.order)) errors.push(`${path}.order must be an integer`);
                return { url: link.url, target: link.target ?? "current", ...(link.order === undefined ? {} : { order: link.order }) };
            }) : [];
            if (input.vehicle !== undefined) {
                if (!object(input.vehicle)) errors.push("vehicle must be an object");
                else {
                    if (input.vehicle.year !== undefined && !Number.isInteger(input.vehicle.year)) errors.push("vehicle.year must be an integer");
                    for (const key of ["make", "model", "trim"]) if (input.vehicle[key] !== undefined && typeof input.vehicle[key] !== "string") errors.push(`vehicle.${key} must be a string`);
                }
            }
            for (const key of ["hidden_desktop", "hidden_mobile"]) if (input[key] !== undefined && typeof input[key] !== "boolean") errors.push(`${key} must be a boolean`);
            if (errors.length) throw new Error(errors.join("; "));
            // Missing order uses the original 1-based position; ties preserve input order.
            const orderedLinks = links.map((link, i) => ({ link, i })).sort((a, b) => (a.link.order ?? a.i + 1) - (b.link.order ?? b.i + 1) || a.i - b.i).map(entry => entry.link);
            return { ...input, start_date: start.toISOString(), end_date: end.toISOString(), description: input.description ?? "", images, links: orderedLinks, hidden_desktop: input.hidden_desktop ?? false, hidden_mobile: input.hidden_mobile ?? false };
        }

        static primaryImage(banner) {
            return banner.images.find(image => image.media === "desktop") ?? banner.images[0];
        }

        static commonWarnings(banner) {
            const warnings = [];
            return warnings;
        }

        static example() {
            const end = new Date();
            end.setMonth(end.getMonth() + 1);
            return { start_date: "", end_date: end.toISOString(), title: "Example offer", description: "", disclaimer: "See dealer for details.", images: [{ url: "https://placehold.co/1600x900.png", alt_text: "Example offer", filename: "offer.png", media: "desktop" }], links: [{ url: "/specials", target: "current" }], hidden_desktop: false, hidden_mobile: false };
        }
    }

    api.BannerInput = BannerInput;
})();
