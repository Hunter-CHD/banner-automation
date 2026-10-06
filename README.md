# Banner automation

Tampermonkey uploaders for Dealer E-Process, DealerOn, Dealer Inspire (DI), and Dealer.com. All four accept pasted JSON in the same banner format. [sample-input.jsonc](sample-input.jsonc) documents the fields with comments.

## Set up GitHub dependencies

1. Create a public GitHub repository for this directory.
2. Set the dependency URLs before installing:

   ```sh
   node scripts/configure-requires.cjs YOUR_GITHUB_OWNER YOUR_REPOSITORY main
   ```

   The third argument can instead be an existing branch, release tag, or commit SHA. Pin a tag or commit for reproducible installs. All seven dependencies in each of the four userscripts are updated together; no build or npm install is needed.

3. Push the userscripts, `lib/`, and `cms/` to that repository/ref.
4. Open the **raw** GitHub URL of the appropriate root `.user.js` file and install it in Tampermonkey. Disable any previously installed standalone version for that CMS.
5. Visit the matching CMS page while signed in, click **+ Banners**, choose the campaign/slider where applicable, paste one banner object per row, and click **Create All Banners**. Dealer.com detects placements from the images and shows a summary beneath each row.

The checked-in `YOUR_GITHUB_OWNER/YOUR_REPOSITORY` URLs are placeholders and must be configured. Tampermonkey loads [`@require` dependencies before the userscript](https://www.tampermonkey.net/documentation.php#meta:require). Dependencies are managed/cached by Tampermonkey, not fetched fresh by this code on every page visit. For releases, update the dependency ref, bump the userscript versions, and update/reinstall the userscripts.

## Input

Paste one JSON object into each banner row; no file upload is needed. The example below is plain JSON, ready to copy and edit. Comments and trailing commas are also accepted as an optional convenience when copying from the annotated reference. The old `images.desktop`, `link`, `start.date`, and `expires.date` formats are replaced by:

```json
{
  "start_date": "",
  "end_date": "2027-12-31T23:59:00-06:00",
  "title": "Example offer",
  "description": "Optional offer description",
  "disclaimer": "See dealer for details.",
  "images": [
    {
      "url": "https://placehold.co/2000x500.png",
      "alt_text": "Example offer",
      "filename": "offer-desktop.png",
      "media": "desktop"
    }
  ],
  "links": [{ "url": "/specials", "target": "current", "order": 1 }],
  "hidden_desktop": false,
  "hidden_mobile": false
}
```

- `title`, `disclaimer`, `end_date`, 1–4 `images`, and a `links` array are required. `links: []` is valid. The sample file is an annotated template; fill its empty required values before submitting.
- Each image needs an absolute HTTP(S) URL, `alt_text`, a filename with extension, and `media: "desktop"` or `"mobile"`. Downloads are cached by URL; supplied filenames and metadata remain specific to each image entry.
- Omitted/empty `start_date` means the current time. ISO dates (`YYYY-MM-DD`) and date-times are accepted; impossible calendar dates and end dates before the start are rejected. Include `Z` or an offset for an exact instant. Values without an offset use the browser's timezone.
- `description` and `vehicle: { year, make, model, trim }` are optional. Vehicle year must be an integer. See the CMS limits below.
- Links accept HTTP(S) or relative URLs. `target` defaults to `current`; use `new` for a new tab where supported. Links sort by `order`; an omitted order uses the original 1-based array position, with ties preserving input order.
- DealerOn's `hidden_desktop` and `hidden_mobile` default to `false`.

All rows pass schema validation before upload starts. A missing/failed required image fails that row. Controls remain locked until the batch and campaign finalization finish. Completed rows are skipped on later submissions. A Dealer E-Process finalization failure marks created rows for manual CMS review to avoid recreating them automatically. A failed request may still have created an asset/record remotely; inspect the CMS before retrying such failures.

## CMS mapping and current limits

The common input does not imply every CMS request supports every field. The uploader displays adapter warnings beside each banner. These mappings preserve the endpoints from the original scripts; they have not been verified against live authenticated CMS accounts.

| CMS | Images | Links | Scheduling and other fields |
| --- | --- | --- | --- |
| Dealer E-Process | First desktop image, or first image if none is desktop; sends its filename and alt text | First ordered link; the existing request has no new-tab option | Start/end calendar dates in browser timezone; choose a campaign in the UI. Appends to existing ads and verifies the saved IDs. |
| DealerOn | First desktop image, or first image if none is desktop; sends its filename and alt text | Existing gallery request does not set a destination; configure it in the CMS | Exact start/end timestamps, disclaimer as comments, explicit device visibility flags. |
| DI | First image per device; if only one device is supplied, reuse it for both; sends filenames and alt text | First ordered link and target | Publishes immediately; `start_date` is not scheduled. Expiration is a calendar date in browser timezone. Choose a slider in the UI. |
| Dealer.com | Up to four entries, automatically assigned by aspect ratio and `media`; one asset per ratio | First two ordered links and their targets; button labels default to “Learn More” | Exact timestamps, description, disclaimer. Automatic type uses Vehicle when vehicle info is populated, otherwise Event. The UI also allows an explicit promotion type. |

Dealer.com downloads and measures images when valid banner JSON is pasted, using the shared image cache. The preview lists the detected ratio, device, and destinations. All supported destinations for that ratio and the image's `media` are enabled automatically, using the original ratio tolerance of 0.2:

| Aspect ratio | Desktop destinations | Mobile destinations |
| --- | --- | --- |
| 4:1 — tall horizontal | Slide | Unsupported |
| 10:1 — short horizontal | Slide, SRP | Unsupported |
| 9:16 — tall vertical | SRP | SRP |
| 4:3 — short vertical | Coupon | Coupon, SRP |

Placements are calculated separately for each banner, so a batch can contain different aspect ratios. Devices without a corresponding input image remain disabled. The same image URL can be supplied for both devices where supported. Unsupported dimensions/device combinations and different image URLs competing for one ratio fail before uploading that banner's images. Upload also revalidates placements even if the preview has not finished. The sample's 1600×900 image is not a supported Dealer.com placement; use one of the supported dimensions.

Dealer.com's current request has no image-alt field. Vehicle promotions apply the original new-condition, make, and model rules; year and trim are not mapped. Incentive mode retains the original year/make fields and still needs incentive/image configuration in the CMS. Description and vehicle targeting are not sent by the other three adapters. Device visibility flags apply only to DealerOn.

## Code layout

```text
*.user.js                 Small CMS-specific entry points and @require metadata
lib/EventBus.js           Shared event routing
lib/Utils.js              HTML fetching and CMS date formatting
lib/BannerInput.js        JSON parsing (also accepts JSONC), validation, and defaults
lib/BannerImage.js        Blob downloading and dimension detection
lib/ImageManager.js       Download caching and input image metadata
lib/UIManager.js          Shared controls, validation, and batch progress
cms/*CMS.js               One class for each CMS's requests and options
scripts/configure-requires.cjs
tests/banner-automation.test.cjs
archive/                  Historical standalone backup; do not install
```

Each dependency registers its class on `globalThis.BannerAutomation` inside the userscript sandbox, so dependencies do not rely on top-level lexical bindings crossing script wrappers. CMS adapters receive normalized banners and prepared image objects (`blob`, `dimensions`, `filetype`, plus the input metadata).

An adapter implements `init()` and `uploadBanner(banner, images)`. Optional hooks: `getFields()` for UI controls, `getWarnings(banner)`, `selectImages(banner)`, `describeImages(images)` for a cached image preview on paste, `prepareBatch()` for selection/nonce checks, and `finishUpload(successfulResults)` for final campaign saves. Keep CMS-specific fields and HTTP payloads in the adapter.

## Verification

Run `npm test` with Node 22 or newer. No dependencies are required. Tests cover JSONC and schema validation, dates/defaults/link ordering, concurrent image caching and failures, mocked payloads for all four CMSes, Dealer.com placement validation, campaign rollback, batch locking/finalization, dependency loading, and GitHub URL configuration. Live CMS uploads require a manual smoke test after installation.
