const fs = require('node:fs');
const path = require('node:path');

function configure(root, owner, repository, ref = 'main') {
    for (const [name, value] of Object.entries({ owner, repository })) {
        if (!value || !/^[A-Za-z0-9_.-]+$/.test(value) || value === '.' || value === '..') throw new Error(`Invalid GitHub ${name}`);
    }
    if (!ref || /[\s?#\\]/.test(ref)) throw new Error('Invalid Git ref');
    const base = `https://raw.githubusercontent.com/${owner}/${repository}/${encodeURIComponent(ref)}`;
    const files = ['dealer-eprocess-banner-upload.user.js', 'dealerOn-banner-upload.user.js', 'di-banner-banner-upload.user.js', 'dealer-dot-com-banner-upload.user.js'];
    const updates = files.map(file => {
        const filename = path.join(root, file);
        const original = fs.readFileSync(filename, 'utf8');
        let count = 0;
        const updated = original.replace(/^(\/\/ @require\s+)https:\/\/raw\.githubusercontent\.com\/[^\r\n]+\/(lib|cms)\/([\w-]+\.js)$/gm, (_, prefix, directory, module) => {
            count++;
            return `${prefix}${base}/${directory}/${module}`;
        });
        if (count !== 7) throw new Error(`Expected 7 @require dependencies in ${file}; found ${count}`);
        return { filename, updated };
    });
    updates.forEach(({ filename, updated }) => fs.writeFileSync(filename, updated));
    return base;
}

if (require.main === module) {
    try {
        const [owner, repository, ref] = process.argv.slice(2);
        if (!owner || !repository) throw new Error('Usage: node scripts/configure-requires.cjs OWNER REPOSITORY [REF]');
        console.log(`Configured all four userscripts: ${configure(path.resolve(__dirname, '..'), owner, repository, ref)}`);
    } catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { configure };
