/* Headless client tests: runs the real static/*.js against a stub DOM + canvas.
 *
 *     gjs tests/run_client_tests.js        (from the project root)
 *
 * gjs is SpiderMonkey, so this is a real JS engine -- it catches syntax errors,
 * missing element ids, bad canvas calls and logic bugs without needing a browser.
 * Each page runs in its own fresh scope.
 */
const GLib = imports.gi.GLib;
const read = f => {
    const [ok, bytes] = GLib.file_get_contents(f);
    if (!ok) throw new Error('cannot read ' + f);
    return new TextDecoder().decode(bytes);
};

/* The element ids come from the real HTML, not from a list kept in the test. That is
 * the whole point: if a script asks for an id the page does not define -- a typo, a
 * renamed control, a widget added to the JS but not the markup -- it lands in MISSING
 * and the run fails. A hardcoded list would happily agree with the JS and miss it. */
function idsIn(htmlPath) {
    const html = read(htmlPath);
    const ids = [], hidden = [];
    // whole tags, so `hidden` is picked up alongside the id -- elements that start
    // hidden (#host, #notice, #qr) behave differently, and a stub that ignored the
    // attribute would let a panel that is never revealed pass as working
    const re = /<[a-zA-Z][^>]*>/g;
    let m;
    while ((m = re.exec(html)) !== null) {
        const tag = m[0];
        const id = /\sid="([^"]+)"/.exec(tag);
        if (!id) continue;
        ids.push(id[1]);
        if (/\shidden(\s|>|=)/.test(tag)) hidden.push(id[1]);
    }
    if (!ids.length) throw new Error('no ids found in ' + htmlPath);
    return { ids, hidden };
}

const PAGES = [
    { name: 'overview', html: 'static/index.html',
      scripts: ['units.js', 'cars.js', 'track.js', 'charts.js', 'net.js', 'overview.js'],
      assertions: 'tests/overview_assertions.js' },
    { name: 'drive', html: 'static/drive.html',
      scripts: ['units.js', 'cars.js', 'cockpit.js', 'fx.js', 'net.js', 'drive.js'],
      assertions: 'tests/drive_assertions.js' },
];

/* Static units check. The scripts can be entirely correct while a hardcoded label in
 * the markup still says km/h next to an mph number -- an assertion on the *value*
 * cannot see that, because the label has no id and is never touched by JS. */
let failed = 0;
const METRIC = [/km\/h/, /veh\/km/, />\s*m\b/, /\bkm\b/];
for (const page of PAGES) {
    const html = read(page.html);
    for (const re of METRIC) {
        const m = html.match(re);
        if (m) {
            failed++;
            print(`  FAIL    ${page.html} still shows a metric unit: "${m[0]}"`);
        }
    }
}
if (!failed) print('  OK      no metric units in the markup of either page\n');

for (const page of PAGES) {
    // element ids are registered by the assertion file BEFORE the page scripts run,
    // so any id the page asks for that index.html/drive.html does not define shows up
    // in MISSING and fails the run
    const info = idsIn(page.html);
    const parts = [read('tests/domstub.js'), read('tests/helpers.js'),
                   'var PAGE_IDS = ' + JSON.stringify(info.ids) + ';',
                   'var PAGE_HIDDEN = ' + JSON.stringify(info.hidden) + ';',
                   read(page.assertions).split('\nprint(')[0]];
    for (const f of page.scripts) parts.push(read('static/' + f));
    parts.push('\nprint(' + read(page.assertions).split('\nprint(').slice(1).join('\nprint('));
    try {
        new Function(parts.join('\n;\n'))();
    } catch (e) {
        failed++;
        print(`FATAL in ${page.name}: ${e.message}`);
        print(e.stack);
    }
    print('');
}
if (failed) imports.system.exit(1);
