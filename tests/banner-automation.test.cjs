const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { configure } = require('../scripts/configure-requires.cjs');
const root = path.resolve(__dirname, '..');
const common = ['EventBus', 'Utils', 'BannerInput', 'BannerImage', 'ImageManager', 'UIManager'];

function runtime(extra = {}, adapter) {
    const context = vm.createContext({ console: { log() {}, error() {}, warn() {} }, URL, URLSearchParams, Blob, FormData, setTimeout, clearTimeout, ...extra });
    for (const file of [...common.map(name => `lib/${name}.js`), ...(adapter ? [`cms/${adapter}.js`] : [])]) vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
    return { context, ...context.BannerAutomation };
}
const plain = value => JSON.parse(JSON.stringify(value));
const raw = () => ({ title: 'Fall offer', disclaimer: 'See dealer for details', start_date: '2026-10-01T09:15:00-05:00', end_date: '2026-12-31T23:59:00-06:00', images: [{ url: 'https://example.com/image.png', filename: 'offer image.png', alt_text: 'Save today', media: 'desktop' }], links: [{ url: '/specials', target: 'new' }] });
const image = (overrides = {}) => ({ ...raw().images[0], blob: new Blob(['image'], { type: 'image/png' }), filetype: 'png', dimensions: { width: 2000, height: 500 }, ...overrides });

test('JSONC preserves quoted comment markers, escaped quotes, and URL text', () => {
    const { BannerInput } = runtime();
    const input = '// comment\n{"url":"https://example.com/a//b", "text":"/* literal */ \\\" quote", /* block */ "items":[1,2,],}';
    assert.deepEqual(plain(BannerInput.parse(input)), { url: 'https://example.com/a//b', text: '/* literal */ " quote', items: [1, 2] });
    assert.throws(() => BannerInput.parse('{/* broken'), /Unterminated/);
    assert.throws(() => BannerInput.parse('{"bad": undefined}'));
    assert.equal(BannerInput.parse(fs.readFileSync(path.join(root, 'sample-input.jsonc'), 'utf8')).images[0].media, 'desktop');
});

test('normalization uses defaults, preserves input, and sorts links stably', () => {
    const { BannerInput } = runtime();
    const input = raw();
    input.start_date = '';
    input.links = [{ url: '/third', order: 3 }, { url: '/second' }, { url: '/first', order: 1 }];
    const original = JSON.stringify(input);
    const result = BannerInput.normalize(input, new Date('2026-10-06T15:00:00Z'));
    assert.equal(result.start_date, '2026-10-06T15:00:00.000Z');
    assert.equal(result.end_date, '2027-01-01T05:59:00.000Z');
    assert.deepEqual(plain(result.links.map(link => link.url)), ['/first', '/second', '/third']);
    assert.equal(result.links[0].target, 'current');
    assert.equal(result.hidden_mobile, false);
    assert.equal(JSON.stringify(input), original);
    assert.deepEqual(plain(BannerInput.normalize({ ...raw(), links: [] }).links), []);
});

test('validation rejects invalid schema, calendar rollovers, and reversed dates', () => {
    const { BannerInput } = runtime();
    for (const [changes, expected] of [
        [{ title: '' }, /title/], [{ disclaimer: 5 }, /disclaimer/], [{ images: [] }, /1–4/],
        [{ images: Array(5).fill(raw().images[0]) }, /1–4/], [{ images: [{ ...raw().images[0], media: 'tablet' }] }, /media/],
        [{ images: [{ ...raw().images[0], url: 'file:///secret', filename: '../test.png' }] }, /HTTP/],
        [{ links: null }, /links/], [{ links: [{ url: 'javascript:alert(1)' }] }, /HTTP/],
        [{ links: [{ url: '/x', target: '_blank', order: 1.2 }] }, /target/],
        [{ end_date: '2026-02-30' }, /calendar/], [{ start_date: '12/31/2026' }, /ISO/],
        [{ end_date: '2026-01-01' }, /precede/], [{ hidden_desktop: 'false' }, /boolean/],
        [{ vehicle: { year: '2026' } }, /integer/], [{ description: 2 }, /description/]
    ]) assert.throws(() => BannerInput.normalize({ ...raw(), ...changes }), expected);
    assert.equal(BannerInput.date('2028-02-29', 'date').getMonth(), 1);
    assert.equal(BannerInput.date('2026-10-06', 'date').getHours(), 0);
});

test('image downloads deduplicate in flight but retain per-input filename and alt text', async () => {
    let calls = 0;
    const { ImageManager } = runtime({
        GM_xmlhttpRequest(options) { calls++; setTimeout(() => options.onload({ status: 200, response: new Blob(['image'], { type: 'image/png' }) }), 0); },
        Image: class { naturalWidth = 2000; naturalHeight = 500; set src(value) { this.onload(); } }
    });
    const manager = new ImageManager();
    const first = raw().images[0];
    const results = await Promise.all([manager.fetchImage(first), manager.fetchImage({ ...first, filename: 'other.png', alt_text: 'Other', media: 'mobile' })]);
    assert.equal(calls, 1);
    assert.equal(results[0].filename, 'offer image.png');
    assert.equal(results[1].filename, 'other.png');
    assert.equal(results[1].alt_text, 'Other');
    assert.deepEqual(plain(results[0].dimensions), { width: 2000, height: 500 });
});

test('image download errors fail the batch and permit a later retry', async () => {
    let failed = true;
    const { ImageManager } = runtime({
        GM_xmlhttpRequest(options) { if (failed) options.ontimeout(); else options.onload({ status: 200, response: new Blob(['ok'], { type: 'image/png' }) }); },
        Image: class { naturalWidth = 10; naturalHeight = 10; set src(value) { this.onload(); } }
    });
    const manager = new ImageManager();
    await assert.rejects(manager.prefetchBannerImages(raw()), /timed out/);
    failed = false;
    assert.equal((await manager.prefetchBannerImages(raw())).length, 1);
});

test('DealerOn maps dates, per-image metadata, filename, and explicit visibility', async () => {
    const requests = [];
    const { DealerOnCMS, BannerInput } = runtime({ fetch: async (url, options) => {
        requests.push({ url, options });
        return { ok: true, json: async () => [] };
    } }, 'DealerOnCMS');
    const cms = Object.create(DealerOnCMS.prototype);
    cms.dealerId = '42'; cms.accessToken = 'token';
    cms.uploadImage = async (blob, filename) => { assert.equal(filename, 'offer image.png'); return 'https://cdn.dlron.us/static/dealer-42/offer.png'; };
    cms._fetchAllBanners = async () => [{ path: '#MISCPATH#offer.png', id: 55 }];
    await cms.uploadBanner(BannerInput.normalize({ ...raw(), hidden_mobile: true }), [image()]);
    const payload = JSON.parse(requests[1].options.body)[0];
    assert.equal(payload.altText, 'Save today');
    assert.equal(payload.hideDesktop, false); assert.equal(payload.hideMobile, true);
    assert.equal(payload.startDate, '2026-10-01T14:15:00.000Z');
    assert.match(cms.getWarnings(BannerInput.normalize(raw())).join(' '), /does not set click links/);
});

test('Dealer E-Process maps new fields and accepts empty links', async () => {
    let payload;
    const { DealerEProcessCMS, BannerInput, Utils } = runtime({ fetch: async (url, options) => {
        payload = JSON.parse(options.body.get('payload'));
        return { ok: true, json: async () => ({ status: 3, payload: { ad_id: 21 } }) };
    } }, 'DealerEProcessCMS');
    const cms = Object.create(DealerEProcessCMS.prototype);
    cms.siteId = '42'; cms.prepareBatch = async () => {};
    cms.uploadImage = async (blob, filename) => { assert.equal(filename, 'offer image.png'); return '123'; };
    const banner = BannerInput.normalize({ ...raw(), links: [] });
    const result = await cms.uploadBanner(banner, [image()]);
    assert.equal(result.ad_id, 21); assert.equal(payload.adv_url, '');
    assert.equal(payload.ad_alt, 'Save today'); assert.equal(payload.ad_title, 'Fall offer');
    assert.equal(payload.date_from, Utils.dateString(banner.start_date));
    assert.equal(payload.date_to, Utils.dateString(banner.end_date));
});

test('Dealer E-Process finalization appends, verifies, and rolls back on mismatched IDs', async () => {
    const { DealerEProcessCMS } = runtime({}, 'DealerEProcessCMS');
    const cms = Object.create(DealerEProcessCMS.prototype);
    cms.currentCampaign = '1'; cms.adCampaigns = [{ id: '1' }];
    const original = { ads: [{ ad_id: 1, sort: 1 }], position: 2, frequency: 3 };
    const saves = [];
    let calls = 0;
    cms.getAdCampaign = async () => ({ serializedAds: calls++ === 0 ? original : { ...original, ads: [] } });
    cms.saveChanges = async (campaign, ads) => { saves.push(plain(ads)); };
    await assert.rejects(cms.finishUpload([{ result: { success: true, result: { ad_id: 2 } } }]), /rolled back/);
    assert.equal(saves[0].ads.length, 2);
    assert.deepEqual(saves[1], original);
});

test('DI selects desktop/mobile assets and sends their filename, alt text, and link', async () => {
    let payload;
    class TestFormData { constructor() { this.data = new Map([['post_ID', '77']]); } [Symbol.iterator]() { return this.data.entries(); } }
    const { DealerInspireCMS, BannerInput } = runtime({
        FormData: TestFormData, window: { location: { origin: 'https://dealer.example' } },
        DOMParser: class { parseFromString() { return { getElementById() { return {}; } }; } },
        fetch: async (url, options) => {
            if (options.method === 'GET') return { ok: true, text: async () => '<form></form>' };
            payload = options.body;
            return { ok: true, url: 'https://dealer.example/wp/wp-admin/post.php?post=77&action=edit&message=6' };
        }
    }, 'DealerInspireCMS');
    const cms = new DealerInspireCMS();
    cms.nonce = 'nonce'; cms.currentSlider = { name: 'Home' };
    const uploaded = [];
    cms.fetchAndUploadImage = async (blob, filename, nonce, alt) => { uploaded.push({ filename, alt }); return { src: filename, id: uploaded.length, width: 100, height: 50 }; };
    const mobile = image({ filename: 'mobile.png', alt_text: 'Mobile offer', media: 'mobile' });
    const banner = BannerInput.normalize({ ...raw(), images: [raw().images[0], { ...raw().images[0], filename: 'mobile.png', media: 'mobile' }] });
    await cms.uploadBanner(banner, [image(), mobile]);
    assert.equal(uploaded[1].filename, 'mobile.png');
    assert.equal(payload.get('slide[desktopImageAlt]'), 'Save today');
    assert.equal(payload.get('slide[mobileImageAlt]'), 'Mobile offer');
    assert.equal(payload.get('slide[slider]'), 'Home');
    assert.equal(payload.get('slide[slideUrl]'), '/specials');
    assert.equal(payload.get('slide[slideUrlTarget]'), 'new');
    assert.equal(cms.selectImages(BannerInput.normalize(raw())).length, 1);
});

test('Dealer.com polls fresh page context until both IDs arrive even with a broken wall clock', async () => {
    const page = {};
    const timers = [];
    const { DealerDotComCMS } = runtime({
        unsafeWindow: page,
        Date: class extends Date { static now() { return NaN; } },
        setTimeout(callback, delay) { timers.push({ callback, delay }); }
    }, 'DealerDotComCMS');
    let settled = false;
    const pending = DealerDotComCMS.waitForContext().finally(() => { settled = true; });
    assert.equal(timers.length, 1);
    assert.equal(timers[0].delay, 250);
    assert.equal(settled, false);
    page.ddc = { global: { account: { accountId: 'account' } } };
    timers.shift().callback();
    await Promise.resolve();
    assert.equal(timers.length, 1);
    assert.equal(settled, false, 'An account without a user is not ready');
    // Replace the global object, as a client-side app can do during initialization.
    page.ddc.global = { account: { accountId: 'account' }, actualUser: { userId: 'user' } };
    timers.shift().callback();
    const cms = await pending;
    assert.equal(cms.accountId, 'account');
    assert.equal(cms.userId, 'user');
    assert.equal(timers.length, 0);
});

test('Dealer.com waits the entire polling budget and reports missing fields on timeout', async () => {
    const delays = [];
    const { DealerDotComCMS } = runtime({
        unsafeWindow: { ddc: { global: { account: { accountId: 'account' } } } },
        setTimeout(callback, delay) { delays.push(delay); callback(); }
    }, 'DealerDotComCMS');
    await assert.rejects(DealerDotComCMS.waitForContext(), error => {
        assert.match(error.message, /121 checks \(30000 ms of polling\)/);
        assert.match(error.message, /Missing: ddc\.global\.actualUser\.userId$/);
        return true;
    });
    assert.equal(delays.length, 120);
    assert.equal(delays.reduce((sum, delay) => sum + delay, 0), 30000);
    delays.length = 0;
    await assert.rejects(DealerDotComCMS.waitForContext(260), /3 checks/);
    assert.deepEqual(delays, [250, 10]);
});

test('Dealer.com checks ready context immediately and validates timeout arguments', async () => {
    const { DealerDotComCMS } = runtime({
        unsafeWindow: { ddc: { global: { account: { accountId: 'account' }, actualUser: { userId: 'user' } } } },
        setTimeout() { assert.fail('Ready context must not schedule a timer'); }
    }, 'DealerDotComCMS');
    assert.equal((await DealerDotComCMS.waitForContext(0)).accountId, 'account');
    for (const timeout of [NaN, Infinity, -1, null, '30000']) {
        await assert.rejects(DealerDotComCMS.waitForContext(timeout), /finite, nonnegative number/);
    }
});

test('Dealer.com uses ISO timestamps, ordered primary/secondary links, description, and media placements', async () => {
    let payload;
    const { DealerDotComCMS, BannerInput } = runtime({
        unsafeWindow: { ddc: { global: { account: { accountId: 'a' }, actualUser: { userId: 'u' } } } },
        fetch: async (url, options) => { payload = JSON.parse(options.body); return { ok: true, json: async () => ({ id: 99 }) }; }
    }, 'DealerDotComCMS');
    const cms = new DealerDotComCMS();
    cms.init = async () => {}; cms.uploadImage = async () => 'cms-asset.png';
    const banner = BannerInput.normalize({ ...raw(), description: 'Description', vehicle: { make: 'Honda', model: 'Civic' }, links: [{ url: '/second', order: 2 }, { url: 'https://example.com/first', target: 'new', order: 1 }] });
    await cms.uploadBanner(banner, [image()]);
    assert.equal(payload.startDate, Date.parse(banner.start_date));
    assert.equal(payload.destinationUrl, 'https://example.com/first');
    assert.equal(payload.ctaConfig.openInNewTab, true);
    assert.equal(payload.secondaryDestinationUrl, '/second');
    assert.equal(payload.i18n.en_US.description, 'Description');
    assert.equal(payload.type, 'VEHICLE');
    assert.equal(payload.placement.en_us.tall_horizontal.desktop.slide, true);
    assert.equal(payload.placement.en_us.short_vertical.mobile.coupon, false);
    assert.equal(payload.placement.en_us.short_vertical.enabled, false);
    assert.equal(payload.rules[0].find(rule => rule.field === 'MODEL').value, 'Civic');
    await cms.uploadBanner(BannerInput.normalize({ ...raw(), links: [] }), [image()]);
    assert.equal(payload.destinationUrl, null); assert.equal(payload.ctaConfig, null);
});

test('Dealer.com rejects unsupported dimensions, device combinations, or conflicting assets before uploading', async () => {
    const { DealerDotComCMS, BannerInput } = runtime({ unsafeWindow: { ddc: { global: { account: { accountId: 'a' }, actualUser: { userId: 'u' } } } } }, 'DealerDotComCMS');
    const cms = new DealerDotComCMS();
    cms.uploadImage = async () => { assert.fail('Must not upload invalid placements'); };
    const banner = BannerInput.normalize(raw());
    await assert.rejects(cms.uploadBanner(banner, [image({ media: 'mobile' })]), /select at least one placement/);
    await assert.rejects(cms.uploadBanner(banner, [image({ dimensions: { width: 1600, height: 900 } })]), /unsupported aspect/);
    await assert.rejects(cms.uploadBanner(banner, [image(), image({ url: 'https://other.example/image.png' })]), /only one asset/);
});

test('Dealer.com defaults to matching ratio/device destinations without global placement controls', async () => {
    const payloads = [];
    const { DealerDotComCMS, BannerInput } = runtime({
        unsafeWindow: { ddc: { global: { account: { accountId: 'a' }, actualUser: { userId: 'u' } } } },
        fetch: async (url, options) => { payloads.push(JSON.parse(options.body)); return { ok: true, json: async () => ({ id: 99 }) }; }
    }, 'DealerDotComCMS');
    const cms = new DealerDotComCMS();
    cms.init = async () => {};
    cms.uploadImage = async () => 'asset.png';
    assert.equal(cms.getFields().some(field => field.type === 'checkbox'), false);
    for (const [width, height, media, placement, expected] of [
        [2000, 500, 'desktop', 'tall_horizontal', { slide: true }],
        [2000, 200, 'desktop', 'short_horizontal', { slide: true, srp: true }],
        [1080, 1920, 'desktop', 'tall_vertical', { srp: true }],
        [1080, 1920, 'mobile', 'tall_vertical', { srp: true }],
        [800, 600, 'desktop', 'short_vertical', { coupon: true }],
        [800, 600, 'mobile', 'short_vertical', { coupon: true, srp: true }]
    ]) {
        const preparedImage = image({ media, dimensions: { width, height } });
        await cms.uploadBanner(BannerInput.normalize(raw()), [preparedImage]);
        const placements = payloads.at(-1).placement.en_us;
        assert.deepEqual(placements[placement][media], expected);
        for (const [otherPlacement, entry] of Object.entries(placements)) {
            assert.equal(entry.enabled, otherPlacement === placement);
            for (const device of ['desktop', 'mobile']) {
                if (otherPlacement !== placement || device !== media) assert.ok(Object.values(entry[device] ?? {}).every(value => value === false));
            }
        }
        assert.match(cms.describeImages([preparedImage]), new RegExp(`${width} × ${height}`));
    }
    assert.equal(DealerDotComCMS.detectPlacementType(2010, 500), 'tall_horizontal');
    assert.equal(DealerDotComCMS.detectPlacementType(0, 0), null);
});

test('Dealer.com shares a detected asset across both devices when the URL is the same', async () => {
    let payload, uploads = 0;
    const { DealerDotComCMS, BannerInput } = runtime({
        unsafeWindow: { ddc: { global: { account: { accountId: 'a' }, actualUser: { userId: 'u' } } } },
        fetch: async (url, options) => { payload = JSON.parse(options.body); return { ok: true, json: async () => ({ id: 99 }) }; }
    }, 'DealerDotComCMS');
    const cms = new DealerDotComCMS();
    cms.init = async () => {};
    cms.uploadImage = async () => { uploads++; return 'asset.png'; };
    await cms.uploadBanner(BannerInput.normalize(raw()), [
        image({ dimensions: { width: 800, height: 600 } }),
        image({ dimensions: { width: 800, height: 600 }, media: 'mobile' })
    ]);
    assert.equal(uploads, 1);
    assert.deepEqual(payload.placement.en_us.short_vertical.desktop, { coupon: true });
    assert.deepEqual(payload.placement.en_us.short_vertical.mobile, { coupon: true, srp: true });
});

function fakeRow(value) {
    const elements = new Map();
    for (const selector of ['textarea', '.wpsoc-banner-title', '.wpsoc-image-preview', '.wpsoc-warnings', '.wpsoc-progress-container', '.wpsoc-progress-fill', '.wpsoc-progress-status']) elements.set(selector, Object.assign(new TestElement(), { value }));
    return { isConnected: true, dataset: { id: 'banner-1' }, querySelector: selector => elements.get(selector), querySelectorAll: () => checkboxes(elements.get('.wpsoc-image-preview')) };
}
class TestElement {
    children = []; style = {}; disabled = false; events = {};
    classList = { add() {}, remove() {} };
    set textContent(value) { this.text = value; this.children = []; }
    get textContent() { return this.text ?? ''; }
    appendChild(child) { this.children.push(child); }
    addEventListener(event, handler) { this.events[event] = handler; }
}
function checkboxes(element) {
    return element.children.flatMap(child => child.type === 'checkbox' ? [child] : checkboxes(child));
}
function fakeUI(cms, value) {
    const alerts = [];
    const { UIManager, EventBus } = runtime({ alert: message => alerts.push(message), document: {
        createElement: () => new TestElement(), createTextNode: value => Object.assign(new TestElement(), { textContent: value })
    } });
    const ui = new UIManager(new EventBus(), cms, { prefetchBannerImages: async () => [image()] });
    const row = fakeRow(value);
    ui.bannersContainer = { querySelectorAll: () => [row] };
    const controls = [row.querySelector('textarea'), { disabled: false }];
    ui.overlay = { querySelectorAll: () => controls };
    return { ui, row, controls, alerts };
}

test('per-banner placement choices start from media, stay isolated, and survive text edits', () => {
    const { DealerDotComCMS } = runtime({}, 'DealerDotComCMS');
    const cms = new DealerDotComCMS({ accountId: 'a', userId: 'u' });
    const banner = raw();
    const groups = cms.getImageOptions([image({ dimensions: { width: 800, height: 600 }, media: 'mobile' })]);
    const { ui, row } = fakeUI(cms, JSON.stringify(banner));
    const otherRow = fakeRow(JSON.stringify(banner));
    ui.renderImageOptions(row, banner, groups);
    ui.renderImageOptions(otherRow, banner, groups);
    const inputs = checkboxes(row.querySelector('.wpsoc-image-preview'));
    assert.deepEqual(inputs.map(input => input.checked), [false, true, true]);
    inputs[0].checked = true; inputs[0].events.change();
    inputs[2].checked = false; inputs[2].events.change();
    assert.deepEqual(plain(row.uploadOptions.placements[groups[0].key]), ['mobile.coupon', 'desktop.coupon']);
    assert.deepEqual(plain(otherRow.uploadOptions.placements[groups[0].key]), ['mobile.coupon', 'mobile.srp']);
    ui.renderImageOptions(row, { ...banner, title: 'Edited title' }, groups);
    assert.deepEqual(checkboxes(row.querySelector('.wpsoc-image-preview')).map(input => input.checked), [true, true, false]);
    for (const input of checkboxes(row.querySelector('.wpsoc-image-preview'))) { input.checked = false; input.events.change(); }
    ui.renderImageOptions(row, banner, groups);
    assert.deepEqual(plain(row.uploadOptions.placements[groups[0].key]), [], 'An explicit empty choice must not revert to defaults');
    const updated = { ...banner, images: [{ ...banner.images[0], media: 'mobile' }] };
    ui.renderImageOptions(row, updated, groups);
    assert.deepEqual(plain(row.uploadOptions.placements[groups[0].key]), ['mobile.coupon', 'mobile.srp']);
});

test('Dealer.com sends only each banner\'s selected placements, including media overrides', async () => {
    const payloads = [];
    let uploads = 0;
    const { DealerDotComCMS, BannerInput } = runtime({ fetch: async (url, options) => {
        payloads.push(JSON.parse(options.body)); return { ok: true, json: async () => ({ id: 99 }) };
    } }, 'DealerDotComCMS');
    const cms = new DealerDotComCMS({ accountId: 'a', userId: 'u' });
    cms.init = async () => {};
    cms.uploadImage = async () => { uploads++; return 'asset.png'; };
    const images = [image({ dimensions: { width: 800, height: 600 }, media: 'mobile' })];
    const key = cms.getImageOptions(images)[0].key;
    const banner = BannerInput.normalize(raw());
    await cms.uploadBanner(banner, images, { placements: { [key]: ['desktop.coupon'] } });
    await cms.uploadBanner(banner, images, { placements: { [key]: ['mobile.srp'] } });
    assert.deepEqual(payloads[0].placement.en_us.short_vertical.desktop, { coupon: true });
    assert.deepEqual(payloads[0].placement.en_us.short_vertical.mobile, { coupon: false, srp: false });
    assert.deepEqual(payloads[1].placement.en_us.short_vertical.desktop, { coupon: false });
    assert.deepEqual(payloads[1].placement.en_us.short_vertical.mobile, { coupon: false, srp: true });
    await assert.rejects(cms.uploadBanner(banner, images, { placements: { [key]: [] } }), /select at least one/);
    await assert.rejects(cms.uploadBanner(banner, images, { placements: { [key]: ['mobile.slide'] } }), /unsupported placement/);
    await assert.rejects(cms.uploadBanner(banner, images, { placements: {} }), /select at least one/);
    assert.equal(uploads, 2);
});

test('UI requires placement preview before upload and passes reviewed choices to the adapter', async () => {
    const { DealerDotComCMS } = runtime({}, 'DealerDotComCMS');
    const cms = new DealerDotComCMS({ accountId: 'a', userId: 'u' });
    const value = JSON.stringify(raw());
    const { ui, row } = fakeUI(cms, value);
    let uploads = 0, selected;
    cms.init = async () => {};
    cms.uploadBanner = async (banner, images, options) => { uploads++; selected = options; return {}; };
    await ui.submit();
    assert.equal(uploads, 0);
    assert.equal(row.imageOptionsReady, true);
    const input = checkboxes(row.querySelector('.wpsoc-image-preview'))[0];
    input.checked = false; input.events.change();
    await ui.submit();
    assert.equal(uploads, 0);
    assert.match(row.querySelector('.wpsoc-progress-status').textContent, /Select at least one/);
    input.checked = true; input.events.change();
    await ui.submit();
    assert.equal(uploads, 1);
    assert.equal(selected, row.uploadOptions);
    assert.equal(input.disabled, true, 'Completed banners must not show editable placement choices');
});

test('placement previews ignore stale downloads and clear when input is removed', async () => {
    const pending = [];
    const value = JSON.stringify(raw());
    const { ui, row } = fakeUI({ describeImages: images => images[0].filename }, value);
    ui.imageManager.prefetchBannerImages = () => new Promise(resolve => pending.push(resolve));
    const first = ui.previewBanner(row, value);
    assert.match(row.querySelector('.wpsoc-image-preview').textContent, /Detecting/);
    const newerValue = JSON.stringify({ ...raw(), title: 'New banner' });
    row.querySelector('textarea').value = newerValue;
    const second = ui.previewBanner(row, newerValue);
    pending[1]([image({ filename: 'new.png' })]);
    await second;
    assert.match(row.querySelector('.wpsoc-image-preview').textContent, /new.png/);
    pending[0]([image({ filename: 'old.png' })]);
    await first;
    assert.doesNotMatch(row.querySelector('.wpsoc-image-preview').textContent, /old.png/);
    const third = ui.previewBanner(row, newerValue);
    row.querySelector('textarea').value = '';
    await ui.previewBanner(row, '');
    pending[2]([image()]);
    await third;
    assert.equal(row.querySelector('.wpsoc-image-preview').textContent, '');
});

test('placement preview shows image errors and leaves other CMS adapters unchanged', async () => {
    const value = JSON.stringify(raw());
    const { ui, row } = fakeUI({ describeImages() { throw new Error('unsupported aspect ratio'); } }, value);
    await ui.previewBanner(row, value);
    assert.match(row.querySelector('.wpsoc-image-preview').textContent, /unsupported aspect ratio/);
    ui.imageManager.prefetchBannerImages = async () => { throw new Error('Download failed'); };
    await ui.previewBanner(row, value);
    assert.match(row.querySelector('.wpsoc-image-preview').textContent, /Download failed/);
    delete ui.cms.describeImages;
    ui.imageManager.prefetchBannerImages = async () => assert.fail('Other CMSes should not prefetch on input');
    await ui.previewBanner(row, value);
    assert.equal(row.querySelector('.wpsoc-image-preview').textContent, '');
});

test('UI validates JSON before CMS work, then unlocks after initialization failure', async () => {
    let calls = 0;
    const { ui, row, controls, alerts } = fakeUI({ init: async () => { calls++; throw new Error('Offline'); } }, '{bad');
    await ui.submit(); assert.equal(calls, 0);
    row.querySelector('textarea').value = JSON.stringify(raw());
    await ui.submit();
    assert.equal(calls, 1); assert.equal(ui.processing, false);
    assert.ok(controls.every(control => !control.disabled));
    assert.match(alerts[0], /Offline/);
});

test('UI keeps controls locked through finalization and prevents duplicate submissions', async () => {
    let release, uploads = 0;
    const pending = new Promise(resolve => { release = resolve; });
    const { ui, row, controls } = fakeUI({ init: async () => {}, uploadBanner: async () => { uploads++; return { ad_id: 1 }; }, finishUpload: async () => pending }, JSON.stringify(raw()));
    const submit = ui.submit();
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(controls.every(control => control.disabled));
    assert.equal(ui.processing, true);
    await ui.submit(); assert.equal(uploads, 1);
    release(); await submit;
    assert.equal(row.dataset.completed, 'true');
    assert.equal(row.querySelector('textarea').disabled, true);
    await ui.submit(); assert.equal(uploads, 1);
});

test('UI marks finalization failures for CMS review without allowing duplicate creation', async () => {
    const { ui, row } = fakeUI({ init: async () => {}, uploadBanner: async () => ({}), finishUpload: async () => { throw new Error('Save rejected'); } }, JSON.stringify(raw()));
    await ui.submit();
    assert.equal(row.dataset.completed, 'review');
    assert.match(row.querySelector('.wpsoc-progress-status').textContent, /finalization failed/);
    assert.equal(ui.processing, false);
});

test('all userscript dependencies exist and load in isolated wrappers in metadata order', () => {
    const scripts = fs.readdirSync(root).filter(file => file.endsWith('.user.js'));
    assert.equal(scripts.length, 4);
    for (const file of scripts) {
        const context = vm.createContext({});
        const source = fs.readFileSync(path.join(root, file), 'utf8');
        const requires = [...source.matchAll(/^\/\/ @require\s+\S+\/(lib|cms)\/(\w+\.js)$/gm)];
        assert.equal(requires.length, 7, file);
        for (const [, directory, module] of requires) vm.runInContext(`(function(){\n${fs.readFileSync(path.join(root, directory, module), 'utf8')}\n})();`, context);
        assert.equal(Object.keys(context.BannerAutomation).length, 7);
        new vm.Script(source, { filename: file });
    }
});

test('GitHub URL configurator updates all modules and preserves entry-point bodies', () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'banner-requires-'));
    try {
        const scripts = fs.readdirSync(root).filter(file => file.endsWith('.user.js'));
        for (const file of scripts) fs.copyFileSync(path.join(root, file), path.join(temp, file));
        configure(temp, 'test-owner', 'banner-automation', 'v2.0.0');
        for (const file of scripts) {
            const source = fs.readFileSync(path.join(temp, file), 'utf8');
            assert.equal((source.match(/raw\.githubusercontent\.com\/test-owner\/banner-automation\/v2\.0\.0/g) || []).length, 7);
            assert.equal(source.split('// ==/UserScript==')[1], fs.readFileSync(path.join(root, file), 'utf8').split('// ==/UserScript==')[1]);
        }
        assert.throws(() => configure(temp, '../bad', 'repo'), /Invalid/);
    } finally {
        // Only remove the unique directory created by mkdtemp above.
        assert.equal(path.dirname(fs.realpathSync(temp)), fs.realpathSync(os.tmpdir()));
        assert.ok(path.basename(temp).startsWith('banner-requires-'));
        fs.rmSync(temp, { recursive: true });
    }
});
