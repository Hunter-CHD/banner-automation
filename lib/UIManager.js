// Shared userscript module. Loaded by Tampermonkey @require.
(function () {
    "use strict";
    const api = globalThis.BannerAutomation ??= {};
    const { BannerInput } = api;

class UIManager {
    /**
     * @param {EventBus} eventBus
     * @param {Object} cms
     * @param {ImageManager} imageManager
     * @param {Object} [options]
     * @param {Array<FieldConfig>} [options.preBannerFields]  Extra controls rendered above the banner list.
     * @param {Array<FieldConfig>} [options.postBannerFields] Extra controls rendered below the banner list.
     *
     * FieldConfig:
     * {
     *   key: string,                       // unique id, used for data-key/event routing
     *   label?: string,                    // visible <label> text
     *   type: "select" | "text" | "checkbox" | "custom",
     *   placeholder?: string,              // select: disabled placeholder option / text: input placeholder
     *   value?: string|boolean,            // initial value
     *   options?: Array<{value, label}>,   // select: static options
     *   optionsAsync?: () => Promise<Array<{value, label}>>, // select: options loaded async (shows "Loading...")
     *   onChange?: (value, eventData) => void, // fires on change/input
     *   render?: (wrapperEl) => HTMLElement|void // type "custom" only: build your own control
     * }
     */
    constructor(eventBus, cms, imageManager, options = {}) {
        this.bus = eventBus;
        this.cms = cms;
        this.imageManager = imageManager;

        this.preBannerFields = options.preBannerFields || [];
        this.postBannerFields = options.postBannerFields || [];

        this.overlay = null;
        this.bannersContainer = null;
        this.preBannerContainer = null;
        this.postBannerContainer = null;
        this.submitBtn = null;
        this.addBannerBtn = null;
        this.bannerCount = 0;

        this.styles = `
        #wpsoc-fab {
            position: fixed; bottom: 24px; right: 24px; z-index: 999999;
            padding: 10px 16px; border-radius: 999px; border: none;
            background: #1d4ed8; color: #fff; font-size: 14px; font-weight: 600;
            cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,0.25);
        }
        #wpsoc-overlay {
            position: fixed; inset: 0; z-index: 999998;
            background: rgba(0,0,0,0.45);
            display: none; align-items: center; justify-content: center;
        }
        #wpsoc-panel {
            background: #fff; width: 800px; max-width: 90vw; max-height: 85vh;
            border-radius: 10px; padding: 20px; box-shadow: 0 10px 30px rgba(0,0,0,0.3);
            display: flex; flex-direction: column; gap: 16px; font-family: sans-serif;
            overflow-y: auto;
        }
        #wpsoc-panel h2 { margin: 0; font-size: 18px; font-weight: 700; }
        #wpsoc-panel label { font-size: 13px; font-weight: 600; }
        #wpsoc-banners-container {
            display: flex; flex-direction: column; gap: 12px;
            max-height: 300px; overflow-y: auto;
        }
        .wpsoc-banner-row {
            border: 1px solid #e5e7eb; border-radius: 6px; padding: 12px;
            display: flex; flex-direction: column; gap: 8px; background: #f9fafb;
        }
        .wpsoc-banner-row textarea {
            width: 100%; min-height: 120px; box-sizing: border-box;
            font-family: monospace; font-size: 12px; padding: 8px;
            border: 1px solid #ccc; border-radius: 6px; resize: vertical;
        }
        .wpsoc-banner-header {
            display: flex; justify-content: space-between; align-items: center;
        }
        .wpsoc-banner-title {
            font-weight: 600; font-size: 13px; color: #374151;
        }
        .wpsoc-remove-btn {
            padding: 4px 10px; border-radius: 4px; border: 1px solid #dc2626;
            background: #fff; color: #dc2626; cursor: pointer; font-size: 12px;
        }
        .wpsoc-remove-btn:hover { background: #fef2f2; }
        .wpsoc-progress-container {
            display: none; flex-direction: column; gap: 4px;
        }
        .wpsoc-progress-container.active { display: flex; }
        .wpsoc-progress-bar {
            width: 100%; height: 20px; background: #e5e7eb; border-radius: 4px; overflow: hidden;
        }
        .wpsoc-progress-fill {
            height: 100%; background: #1d4ed8; transition: width 0.3s ease;
            display: flex; align-items: center; justify-content: center;
            color: #fff; font-size: 11px; font-weight: 600;
        }
        .wpsoc-progress-status {
            font-size: 12px; color: #6b7280;
        }
        .wpsoc-progress-status.error { color: #dc2626; }
        .wpsoc-progress-status.success { color: #16a34a; }
        .wpsoc-image-preview:empty { display: none; }
        #wpsoc-add-banner {
            padding: 8px 14px; border-radius: 6px; border: 1px solid #1d4ed8;
            background: #fff; color: #1d4ed8; cursor: pointer; font-size: 13px;
            font-weight: 600;
        }
        #wpsoc-add-banner:hover { background: #eff6ff; }
        #wpsoc-buttons { display: flex; justify-content: space-between; gap: 8px; }
        #wpsoc-buttons-right { display: flex; gap: 8px; }
        #wpsoc-buttons button {
            padding: 8px 14px; border-radius: 6px; border: 1px solid #ccc;
            cursor: pointer; font-size: 13px;
        }
        #wpsoc-submit { background: #1d4ed8; color: #fff; border-color: #1d4ed8; font-weight: 600; }
        #wpsoc-submit:disabled { opacity: 0.6; cursor: default; }

        .wpsoc-extra-fields {
            display: flex; flex-direction: column; gap: 10px;
        }
        .wpsoc-extra-fields:empty { display: none; }
        .wpsoc-field {
            display: flex; flex-direction: column; gap: 4px;
        }
        .wpsoc-field label {
            font-size: 12px; font-weight: 600; color: #374151;
        }
        .wpsoc-field select,
        .wpsoc-field input[type="text"] {
            padding: 6px 8px; border: 1px solid #ccc; border-radius: 6px;
            font-size: 13px; font-family: sans-serif; background: #fff;
        }
        .wpsoc-field select:disabled { color: #9ca3af; }
        .wpsoc-field.wpsoc-field-checkbox {
            flex-direction: row; align-items: center; gap: 8px;
        }
        `;


        this.placeholderData = BannerInput.example();
    }

    injectFloatingButton(){
        const floatingButton = document.createElement("button");
        floatingButton.id = "wpsoc-fab";
        floatingButton.textContent = "+ Banners";
        floatingButton.dataset.key = "ui.fab";
        floatingButton.dataset.events = "click";
        document.body.appendChild(floatingButton);
        this.button = floatingButton;
    }

    injectOverlay(){
        const overlay = document.createElement("div");
        overlay.id = "wpsoc-overlay";
        overlay.dataset.key = "ui.overlay";
        overlay.dataset.events = "click";
        overlay.innerHTML = `
            <div id="wpsoc-panel">
                <h2>Create Banners</h2>
                <div id="wpsoc-pre-banner-fields" class="wpsoc-extra-fields"></div>
                <label>Banners — paste one JSON object per row:</label>
                <div id="wpsoc-banners-container"></div>
                <button id="wpsoc-add-banner" type="button" data-key="ui.addBanner" data-events="click">+ Add Banner</button>
                <div id="wpsoc-post-banner-fields" class="wpsoc-extra-fields"></div>

                <div id="wpsoc-buttons">
                    <div></div>
                    <div id="wpsoc-buttons-right">
                        <button id="wpsoc-cancel" type="button" data-key="ui.cancel" data-events="click">Close</button>
                        <button id="wpsoc-submit" type="button" data-key="ui.submit" data-events="click">Create All Banners</button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        this.overlay = overlay;
        this.bannersContainer = overlay.querySelector("#wpsoc-banners-container");
        this.preBannerContainer = overlay.querySelector("#wpsoc-pre-banner-fields");
        this.postBannerContainer = overlay.querySelector("#wpsoc-post-banner-fields");
        this.submitBtn = overlay.querySelector("#wpsoc-submit");
        this.addBannerBtn = overlay.querySelector("#wpsoc-add-banner");

        this.preBannerFields.forEach(field => this.renderField(field, this.preBannerContainer));
        this.postBannerFields.forEach(field => this.renderField(field, this.postBannerContainer));
    }

    // ---- Generic extra-field rendering (pre/post banner options) ----

    renderField(field, container) {
        if (!field || !field.key) {
            console.warn("Skipping field with no key", field);
            return null;
        }

        const wrapper = document.createElement("div");
        wrapper.className = "wpsoc-field";
        if (field.type === "checkbox") wrapper.classList.add("wpsoc-field-checkbox");
        wrapper.dataset.fieldKey = field.key;

        const fieldId = `wpsoc-field-${field.key}`;

        if (field.label && field.type !== "custom") {
            const label = document.createElement("label");
            label.textContent = field.label;
            label.setAttribute("for", fieldId);
            wrapper.appendChild(label);
        }

        let inputEl;

        switch (field.type) {
            case "select": {
                inputEl = document.createElement("select");
                inputEl.id = fieldId;
                this.populateSelectOptions(inputEl, field);
                break;
            }
            case "text": {
                inputEl = document.createElement("input");
                inputEl.type = "text";
                inputEl.id = fieldId;
                if (field.placeholder) inputEl.placeholder = field.placeholder;
                if (field.value !== undefined) inputEl.value = field.value;
                break;
            }
            case "checkbox": {
                inputEl = document.createElement("input");
                inputEl.type = "checkbox";
                inputEl.id = fieldId;
                if (field.checked || field.value) inputEl.checked = true;
                break;
            }
            case "custom": {
                if (typeof field.render === "function") {
                    const customEl = field.render(wrapper);
                    if (customEl instanceof HTMLElement) wrapper.appendChild(customEl);
                }
                container.appendChild(wrapper);
                return wrapper;
            }
            default:
                console.warn(`Unknown field type "${field.type}" for field "${field.key}"`);
                return null;
        }

        inputEl.dataset.key = `field.${field.key}`;
        inputEl.dataset.events = field.event || (field.type === "text" ? "input" : "change");
        wrapper.appendChild(inputEl);
        container.appendChild(wrapper);

        if (typeof field.onChange === "function") {
            this.bus.subscribe(`field.${field.key}:${inputEl.dataset.events}`, (data) => {
                field.onChange(data.value, data);
            });
        }

        if (field.type === "select" && typeof field.optionsAsync === "function") {
            this.loadAsyncOptions(inputEl, field);
        }

        return wrapper;
    }

    populateSelectOptions(selectEl, field) {
        selectEl.innerHTML = "";

        if (field.placeholder) {
            const placeholderOpt = document.createElement("option");
            placeholderOpt.value = "";
            placeholderOpt.textContent = field.placeholder;
            placeholderOpt.disabled = true;
            placeholderOpt.selected = field.value === undefined;
            selectEl.appendChild(placeholderOpt);
        }

        (field.options || []).forEach(opt => {
            const optionEl = document.createElement("option");
            optionEl.value = opt.value;
            optionEl.textContent = opt.label;
            if (field.value !== undefined && String(opt.value) === String(field.value)) {
                optionEl.selected = true;
            }
            selectEl.appendChild(optionEl);
        });
    }

    async loadAsyncOptions(selectEl, field) {
        selectEl.disabled = true;
        selectEl.innerHTML = "";
        const loadingOpt = document.createElement("option");
        loadingOpt.textContent = "Loading...";
        loadingOpt.disabled = true;
        loadingOpt.selected = true;
        selectEl.appendChild(loadingOpt);

        try {
            const opts = await field.optionsAsync();
            field.options = opts || [];
            this.populateSelectOptions(selectEl, field);
            selectEl.disabled = false;
        } catch (err) {
            selectEl.innerHTML = "";
            const errOpt = document.createElement("option");
            errOpt.textContent = "Failed to load options";
            errOpt.disabled = true;
            errOpt.selected = true;
            selectEl.appendChild(errOpt);
            console.error(`Failed to load options for field "${field.key}":`, err);
        }
    }

    createBannerRow() {
        this.bannerCount++;
        const rowId = `banner-${this.bannerCount}`;

        const row = document.createElement("div");
        row.className = "wpsoc-banner-row";
        row.dataset.id = rowId;
        row.innerHTML = `
            <div class="wpsoc-banner-header">
                <span class="wpsoc-banner-title">Banner #${this.bannerCount}</span>
                <button class="wpsoc-remove-btn" type="button" data-key="banner.${rowId}.remove" data-events="click">Remove</button>
            </div>
            <textarea data-key="banner.${rowId}.json" data-events="input"></textarea>
            <div class="wpsoc-warnings" style="font-size:12px;color:#92400e" role="status"></div>
            <div class="wpsoc-image-preview" style="font-size:12px;white-space:pre-line" role="status"></div>
            <div class="wpsoc-progress-container">
                <div class="wpsoc-progress-bar">
                    <div class="wpsoc-progress-fill" style="width: 0%">0%</div>
                </div>
                <div class="wpsoc-progress-status"></div>
            </div>
        `;

        const textarea = row.querySelector("textarea");
        textarea.setAttribute("placeholder", JSON.stringify(this.placeholderData, null, 2));

        // bind events for this row
        this.bus.bindChildren(row);

        this.bannersContainer.appendChild(row);
        this.bus.emit(`banner.${rowId}:created`, { rowId, row });
        return row;
    }

    registerSubscribers(){
        // event subscriptions
        this.bus.subscribe("ui.fab:click", () => {
            this.overlay.style.display = "flex";
            this.bus.emit("ui.overlay:opened");
        });

        this.bus.subscribe("ui.cancel:click", () => {
            this.overlay.style.display = "none";
            this.bus.emit("ui.overlay:closed");
        });

        this.bus.subscribe("ui.overlay:click", (data) => {
            if (data.element === this.overlay) {
                this.overlay.style.display = "none";
                this.bus.emit("ui.overlay:closed");
            }
        });

        this.bus.subscribe("ui.addBanner:click", () => {
            this.createBannerRow();
            this.bannersContainer.scrollTop = this.bannersContainer.scrollHeight;
        });

        this.bus.subscribe("banner.**.remove:click", async (data) => {
            const bannerId = data.key.split(".")[1];
            const row = this.bannersContainer.querySelector(`[data-id="${bannerId}"]`);
            if (row) {
                row.remove();
                this.bus.emit(`banner.${bannerId}:removed`, { bannerId });
            }
        });

        this.bus.subscribe("banner.**.json:input", async (data) => {
            const bannerId = data.key.split(".")[1];
            const row = this.bannersContainer.querySelector(`[data-id="${bannerId}"]`);
            if (row) await this.previewBanner(row, data.value ?? "");
        });
    }

    async previewBanner(row, value) {
        const revision = row.previewRevision = (row.previewRevision ?? 0) + 1;
        const preview = row.querySelector(".wpsoc-image-preview");
        const warnings = row.querySelector(".wpsoc-warnings");
        preview.textContent = "";
        warnings.textContent = "";
        let banner;
        try { banner = BannerInput.normalize(BannerInput.parse(value)); }
        catch { return; } // Clear stale results while the user is editing incomplete JSON.
        row.querySelector(".wpsoc-banner-title").textContent = banner.title;
        warnings.textContent = (this.cms.getWarnings?.(banner) ?? []).join(" ");
        if (!this.cms.describeImages) return;
        preview.textContent = "Detecting image placements...";
        // A download for old input must not overwrite a newer preview or a removed row.
        const current = () => row.isConnected && row.previewRevision === revision && row.querySelector("textarea").value === value;
        try {
            const images = await this.imageManager.prefetchBannerImages({ ...banner, images: this.cms.selectImages?.(banner) ?? banner.images });
            if (current()) preview.textContent = "Detected placements:\n" + this.cms.describeImages(images);
        } catch (error) {
            if (current()) preview.textContent = "Placement detection failed: " + error.message;
        }
    }

    registerSubmitHandler() {
        this.bus.subscribe("ui.submit:click", () => this.submit());
    }

    async submit() {
        if (this.processing) return;
        const rows = Array.from(this.bannersContainer.querySelectorAll(".wpsoc-banner-row"))
            .filter(row => !row.dataset.completed);
        if (!rows.length) { alert("Please add a banner that has not already been uploaded"); return; }
        // Validate every row before any CMS writes.
        const entries = [];
        for (const row of rows) {
            try {
                const banner = BannerInput.normalize(BannerInput.parse(row.querySelector("textarea").value));
                row.querySelector(".wpsoc-warnings").textContent = (this.cms.getWarnings?.(banner) ?? []).join(" ");
                entries.push({ row, banner });
            } catch (error) { this.showBannerError(row, error.message); }
        }
        if (entries.length !== rows.length) return;
        this.processing = true;
        const controls = Array.from(this.overlay.querySelectorAll("input, select, textarea, button"));
        const disabled = controls.map(control => control.disabled);
        controls.forEach(control => { control.disabled = true; });
        const processed = [];
        try {
            await this.cms.init();
            await this.cms.prepareBatch?.();
            this.bus.emit("banners:processing-started", { count: entries.length });
            for (const { row, banner } of entries) {
                const result = await this.processBanner(row, banner);
                processed.push({ id: row.dataset.id, banner, result });
            }
            const successful = processed.filter(entry => entry.result.success);
            if (successful.length) await this.cms.finishUpload?.(successful);
            for (const { row } of entries) {
                if (processed.some(entry => entry.id === row.dataset.id && entry.result.success)) {
                    row.dataset.completed = "true";
                    row.querySelector(".wpsoc-progress-status").textContent = "Complete";
                }
            }
            this.bus.emit("banners:processing-complete", { banners: processed });
        } catch (error) {
            // Created records may exist even if final campaign attachment failed. Do not recreate them.
            for (const { row } of entries) {
                if (processed.some(entry => entry.id === row.dataset.id && entry.result.success)) {
                    row.dataset.completed = "review";
                    this.showBannerError(row, "Banner created, but finalization failed. Review the CMS before retrying. " + error.message);
                }
            }
            alert("Upload workflow failed: " + error.message);
        } finally {
            controls.forEach((control, i) => { control.disabled = disabled[i]; });
            for (const { row } of entries) if (row.dataset.completed) row.querySelector("textarea").disabled = true;
            this.processing = false;
        }
    }

    async processBanner(row, banner) {
        const elements = {
            progressContainer: row.querySelector(".wpsoc-progress-container"),
            progressFill: row.querySelector(".wpsoc-progress-fill"),
            progressStatus: row.querySelector(".wpsoc-progress-status"),
            textarea: row.querySelector("textarea")
        };
        const bannerId = row.dataset.id;

        elements.progressStatus.classList.remove("error", "success");
        elements.progressContainer.classList.add("active");
        elements.textarea.disabled = true;

        const updateProgress = (percent, message) => {
            elements.progressFill.style.width = `${percent}%`;
            elements.progressFill.textContent = `${percent}%`;
            elements.progressStatus.textContent = message;
            this.bus.emit(`banner.${bannerId}:progress`, { bannerId, percent, status: message });
        };

        try {
            updateProgress(10, "Validating...");
            updateProgress(20, "Preparing images...");
            const images = await this.imageManager.prefetchBannerImages({ ...banner, images: this.cms.selectImages?.(banner) ?? banner.images });

            updateProgress(40, "Uploading to CMS...");
            const result = await this.cms.uploadBanner(banner, images);

            updateProgress(100, this.cms.finishUpload ? "Created; saving campaign..." : "Complete");
            elements.progressStatus.classList.add("success");

            console.log("Banner created:", result);
            this.bus.emit(`banner.${bannerId}:complete`, { id:bannerId, banner:banner, uploaded:result });

            return { success: true, result: result };
        } catch (err) {
            updateProgress(0, `✗ Error: ${err.message}`);
            elements.progressStatus.classList.add("error");
            
            console.error(`Banner ${bannerId} failed:`, err);
            this.bus.emit(`banner.${bannerId}:error`, { id:bannerId, error: err.message });
            
            return { success: false, error: err.message };
        }
    }

    showBannerError(row, message) {
        const progressContainer = row.querySelector(".wpsoc-progress-container");
        const progressStatus = row.querySelector(".wpsoc-progress-status");
        
        progressContainer.classList.add("active");
        progressStatus.textContent = `✗ ${message}`;
        progressStatus.classList.remove("success");
        progressStatus.classList.add("error");
    }

    init() {
        GM_addStyle(this.styles);
        this.injectFloatingButton();
        this.injectOverlay();
        this.registerSubscribers();
        this.registerSubmitHandler();
        this.bus.bindChildren(this.overlay);
        this.bus.bindInput(this.button, "click");
        this.cms.init().catch(err => console.error("Failed to initialize CMS:", err));
        this.createBannerRow();
    }
}

    api.UIManager = UIManager;
})();
