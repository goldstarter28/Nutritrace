const { useEffect, useMemo, useState } = React;
const { unzipSync, strFromU8 } = fflate;
const SOURCE_META = {
    USDA_FOUNDATION: { name: 'USDA FoodData Central · Foundation Foods', version: '04/2026', mode: 'local', official: true, scientific: true },
    USDA_SR: { name: 'USDA FoodData Central · SR Legacy', version: '04/2018', mode: 'local', official: true, scientific: true },
    CIQUAL: { name: 'ANSES-CIQUAL', version: '2025', mode: 'local', official: true, scientific: true },
    FRIDA: { name: 'FRIDA / DTU Food Institute', version: '5.5 (2025)', mode: 'local', official: true, scientific: true },
    COFID: { name: 'UK CoFID', version: '2021', mode: 'local', official: true, scientific: true },
    USDA_BRANDED: { name: 'USDA FoodData Central · Branded', version: 'online', mode: 'online', official: true, scientific: false },
};
const SCIENTIFIC_SOURCES = ['USDA_FOUNDATION', 'USDA_SR', 'CIQUAL', 'FRIDA', 'COFID'];
const clean = s => String(s ?? '').trim();
const norm = s => clean(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/µ/g, 'u').replace(/[^a-z0-9]+/g, ' ').trim();
function num(v) {
    if (v === null || v === undefined || v === '')
        return null;
    if (typeof v === 'number')
        return Number.isFinite(v) ? v : null;
    let s = String(v).trim().replace(',', '.');
    if (!s || /^(tr|trace|n|nd|na|-)$/i.test(s))
        return null;
    s = s.replace(/^</, '').replace(/[^0-9.+-]/g, '');
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
}
// Espansioni volutamente semplici: aiutano la ricerca in italiano nei dataset EN/FR/DK.
// Dopo il primo utilizzo l'alias italiano viene salvato nell'archivio personale, quindi non serve più tradurre.
const IT_SYNONYMS = {
    pasta: ['pasta', 'spaghetti', 'macaroni', 'noodle', 'noodles', 'pates'], petto: ['breast'], coscia: ['thigh'],
    integrale: ['whole wheat', 'wholewheat', 'whole grain', 'wholegrain', 'wholemeal', 'complet', 'complete', 'complets', 'completes'],
    riso: ['rice', 'riz', 'ris'], pollo: ['chicken', 'poulet', 'kylling'], tacchino: ['turkey', 'dinde', 'kalkun'],
    salmone: ['salmon', 'saumon', 'laks'], tonno: ['tuna', 'thon', 'tun'], merluzzo: ['cod', 'cabillaud', 'torsk'],
    mela: ['apple', 'pomme', 'aeble'], pera: ['pear', 'poire', 'paere'], banana: ['banana', 'banane'], arancia: ['orange'],
    fragola: ['strawberry', 'fraise', 'jordbaer'], mirtilli: ['blueberry', 'blueberries', 'myrtille'],
    uovo: ['egg', 'oeuf', 'aeg'], uova: ['eggs', 'oeufs', 'aeg'], latte: ['milk', 'lait', 'maelk'],
    yogurt: ['yogurt', 'yoghurt', 'yaourt'], formaggio: ['cheese', 'fromage', 'ost'], pane: ['bread', 'pain', 'brod'],
    avena: ['oat', 'oats', 'avoine', 'havre'], farro: ['farro', 'spelt', 'épeautre', 'épeautre'],
    lenticchie: ['lentil', 'lentils', 'lentille', 'linser'], ceci: ['chickpea', 'chickpeas', 'pois chiche', 'kikært'],
    fagioli: ['bean', 'beans', 'haricot', 'bonner'], patata: ['potato', 'pomme de terre', 'kartoffel'], patate: ['potatoes', 'pommes de terre', 'kartofler'],
    pomodoro: ['tomato', 'tomate'], pomodori: ['tomatoes', 'tomates'], carota: ['carrot', 'carotte', 'gulerod'],
    zucchina: ['zucchini', 'courgette', 'squash'], broccoli: ['broccoli'], spinaci: ['spinach', 'epinard', 'spinat'],
    mandorle: ['almond', 'almonds', 'amande', 'mandler'], noci: ['walnut', 'walnuts', 'noix', 'valnod'],
    arachidi: ['peanut', 'peanuts', 'cacahuete', 'jordnod'], olio: ['oil', 'huile', 'olie'], oliva: ['olive'],
    manzo: ['beef', 'boeuf', 'okse'], maiale: ['pork', 'porc', 'svin'], crudo: ['raw', 'cru'], cotto: ['cooked', 'boiled', 'cuit'],
    bollito: ['boiled', 'cooked', 'bouilli'], grigliato: ['grilled', 'grille'], secco: ['dry', 'dried', 'sec'],
};
function queryTokens(q) { const stop = new Set(['di', 'del', 'della', 'dei', 'degli', 'delle', 'a', 'al', 'alla', 'con', 'senza', 'e', 'o']); return norm(q).split(' ').filter(x => x && !stop.has(x)); }
function tokenAlternatives(token) { return [token, ...(IT_SYNONYMS[token] || [])].map(norm); }
function phraseAlternatives(q) {
    const n = norm(q);
    const out = [n];
    if (n === 'pasta integrale')
        out.push('whole wheat pasta', 'wholemeal pasta', 'pates completes', 'whole grain pasta');
    if (n === 'riso integrale')
        out.push('brown rice', 'whole grain rice', 'riz complet');
    if (n === 'pane integrale')
        out.push('whole wheat bread', 'wholemeal bread', 'pain complet');
    return out;
}
const FIELD_ALIASES = {
    kcal: ['energy kcal', 'energie kcal', 'energia kcal', 'energy kcal 100g', 'energy kcal per 100g', 'kcal'],
    protein: ['protein', 'proteines', 'proteine', 'protein g', 'protein g 100g'],
    carbs: ['carbohydrate', 'carbohydrates', 'glucides', 'carboidrati', 'carbohydrate g'],
    sugar: ['sugars', 'sum sugars', 'sucres', 'zuccheri', 'total sugars'],
    fat: ['fat', 'lipids', 'lipides', 'grassi', 'total fat'],
    saturatedFat: ['saturates', 'saturated fatty acids', 'saturated fat', 'acides gras satures', 'grassi saturi'],
    fiber: ['fibre', 'fiber', 'dietary fibre', 'fibres alimentaires', 'fibre alimentaire'],
    salt: ['salt', 'sel chlorure de sodium', 'sale'], sodium: ['sodium', 'sodio'],
};
const NUTRIENT_ALIASES = {
    'Calcio': ['calcium', 'calcio'], 'Ferro': ['iron', 'fer', 'ferro'], 'Magnesio': ['magnesium', 'magnesio'],
    'Potassio': ['potassium', 'potassio'], 'Zinco': ['zinc', 'zinco'], 'Rame': ['copper', 'cuivre', 'rame'],
    'Manganese': ['manganese'], 'Selenio': ['selenium', 'selenio'], 'Iodio': ['iodine', 'iode', 'iodio'],
    'Fosforo': ['phosphorus', 'phosphore', 'fosforo'], 'Vitamina C': ['vitamin c', 'vitamine c', 'vitamina c'],
    'Vitamina D': ['vitamin d', 'vitamine d', 'vitamina d'], 'Vitamina E': ['vitamin e', 'vitamine e', 'vitamina e'],
    'Tiamina B1': ['thiamin', 'thiamine', 'vitamine b1', 'tiamina'], 'Riboflavina B2': ['riboflavin', 'riboflavine', 'vitamine b2'],
    'Niacina B3': ['niacin', 'niacine', 'vitamine b3'], 'Vitamina B6': ['vitamin b6', 'vitamine b6'],
    'Folati': ['folate', 'folates', 'folates totaux', 'vitamin b9', 'vitamine b9'], 'Acido folico': ['folic acid', 'acide folique'],
    'Vitamina B12': ['vitamin b12', 'vitamine b12'], 'Vitamina K': ['vitamin k', 'vitamine k'],
    'ALA': ['alpha linolenic', 'alpha linolenique', '18 3 n 3', 'c18 3 n 3'], 'EPA': ['eicosapentaenoic', '20 5 n 3', 'c20 5 n 3'],
    'DHA': ['docosahexaenoic', '22 6 n 3', 'c22 6 n 3'], 'Acido linoleico (LA)': ['linoleic acid', '18 2 n 6', 'c18 2 n 6'],
    'Colesterolo': ['cholesterol'],
    'Leucina': ['leucine'], 'Isoleucina': ['isoleucine'], 'Valina': ['valine'], 'Lisina': ['lysine'], 'Metionina': ['methionine'],
    'Treonina': ['threonine'], 'Triptofano': ['tryptophan'], 'Istidina': ['histidine'], 'Fenilalanina': ['phenylalanine'],
    'Fruttosio': ['fructose'], 'Glucosio': ['glucose'], 'Galattosio': ['galactose'], 'Lattosio': ['lactose'], 'Saccarosio': ['sucrose'],
};
function matchesHeader(header, aliases) { const h = norm(header); return aliases.some(a => h === norm(a) || h.includes(norm(a))); }
function unitFromHeader(h, fallback = 'mg') { const n = norm(h); if (/\b(kcal)\b/.test(n))
    return 'kcal'; if (/\b(ug|mcg)\b/.test(n))
    return 'µg'; if (/\bmg\b/.test(n))
    return 'mg'; if (/\bg\b/.test(n))
    return 'g'; return fallback; }
function findNameKey(keys) { const candidates = ['alim nom fr', 'food name', 'foodname', 'food name english', 'name', 'description', 'food', 'foedevare navn', 'fødevare navn']; return keys.find(k => candidates.some(c => norm(k) === norm(c))) || keys.find(k => /(food|aliment|alim|fødevare).*(name|nom|navn)|description/.test(norm(k))); }
function findIdKey(keys) { return keys.find(k => /(food id|foodid|alim code|code alim|id food|food code|fdc id|fdc_id)/.test(norm(k))) || null; }
function findBrandKey(keys) { return keys.find(k => /(brand|marque|marca)/.test(norm(k))) || null; }
function sourceRef(source, id) { return `${SOURCE_META[source]?.name || source}${id ? ` · ${id}` : ''}`; }
function newId() { return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`; }
function emptyLabel() { return { kcal: '', protein: '', carbs: '', sugar: '', fat: '', saturatedFat: '', fiber: '', salt: '' }; }
function normalizeWideRows(source, rows) {
    if (!rows?.length)
        return [];
    const keys = Object.keys(rows.find(r => r && Object.keys(r).length) || {});
    const nameKey = findNameKey(keys);
    const idKey = findIdKey(keys);
    const brandKey = findBrandKey(keys);
    if (!nameKey)
        return [];
    const out = [];
    for (const r of rows) {
        const name = clean(r[nameKey]);
        if (!name)
            continue;
        const label = emptyLabel();
        const nutrients = [];
        for (const [key, val] of Object.entries(r)) {
            const v = num(val);
            if (v === null)
                continue;
            for (const [field, aliases] of Object.entries(FIELD_ALIASES))
                if (matchesHeader(key, aliases)) {
                    if (field === 'sodium') {
                        if (label.salt === '')
                            label.salt = v * 2.5 / (unitFromHeader(key) === 'mg' ? 1000 : 1);
                    }
                    else if (label[field] === '')
                        label[field] = v;
                }
            for (const [display, aliases] of Object.entries(NUTRIENT_ALIASES))
                if (matchesHeader(key, aliases)) {
                    nutrients.push({ id: newId(), name: display, form: 'naturalmente presente / non specificata', amount: v, unit: unitFromHeader(key, ['Folati', 'Vitamina B12', 'Vitamina D', 'Iodio'].includes(display) ? 'µg' : 'mg'), source: SOURCE_META[source].name, evidence: 'dataset ufficiale', bio: { mode: 'none' } });
                    break;
                }
        }
        out.push({ localId: `${source}:${clean(r[idKey]) || out.length + 1}`, source, sourceId: clean(r[idKey]) || String(out.length + 1), name, officialName: name, brand: brandKey ? clean(r[brandKey]) : '', servingGrams: 100, label, nutrients, ingredients: '', aliases: [], sourceInfo: { id: newId(), name: SOURCE_META[source].name, reference: sourceRef(source, clean(r[idKey])), quality: 'primaria', version: SOURCE_META[source].version } });
    }
    return out;
}
function normalizeLongRows(source, rows) {
    if (!rows?.length)
        return [];
    const keys = Object.keys(rows.find(r => r && Object.keys(r).length) || {});
    const idKey = findIdKey(keys);
    const nameKey = findNameKey(keys);
    const paramKey = keys.find(k => /(parameter name|parameter|component|nutrient)/.test(norm(k)));
    const valueKey = keys.find(k => /^(value|amount|content)$/.test(norm(k))) || keys.find(k => /(value|amount|content)/.test(norm(k)));
    const unitKey = keys.find(k => /^unit$/.test(norm(k)) || /unit/.test(norm(k)));
    if (!nameKey || !paramKey || !valueKey)
        return [];
    const grouped = new Map();
    for (const r of rows) {
        const id = clean(idKey ? r[idKey] : r[nameKey]);
        const name = clean(r[nameKey]);
        if (!name)
            continue;
        if (!grouped.has(id))
            grouped.set(id, { id, name, rows: [] });
        grouped.get(id).rows.push(r);
    }
    const out = [];
    for (const g of grouped.values()) {
        const label = emptyLabel();
        const nutrients = [];
        for (const r of g.rows) {
            const p = clean(r[paramKey]);
            const v = num(r[valueKey]);
            if (v === null)
                continue;
            const unit = clean(unitKey ? r[unitKey] : '') || unitFromHeader(p);
            for (const [field, aliases] of Object.entries(FIELD_ALIASES))
                if (matchesHeader(p, aliases)) {
                    if (field === 'sodium') {
                        if (label.salt === '')
                            label.salt = v * 2.5 / (unit.toLowerCase() === 'mg' ? 1000 : 1);
                    }
                    else if (label[field] === '')
                        label[field] = v;
                }
            for (const [display, aliases] of Object.entries(NUTRIENT_ALIASES))
                if (matchesHeader(p, aliases)) {
                    nutrients.push({ id: newId(), name: display, form: 'naturalmente presente / non specificata', amount: v, unit: unit.replace(/ug/i, 'µg'), source: SOURCE_META[source].name, evidence: 'dataset ufficiale', bio: { mode: 'none' } });
                    break;
                }
        }
        out.push({ localId: `${source}:${g.id}`, source, sourceId: g.id, name: g.name, officialName: g.name, brand: '', servingGrams: 100, label, nutrients, ingredients: '', aliases: [], sourceInfo: { id: newId(), name: SOURCE_META[source].name, reference: sourceRef(source, g.id), quality: 'primaria', version: SOURCE_META[source].version } });
    }
    return out;
}
function normalizeRows(source, rows) { const keys = Object.keys(rows?.[0] || {}); const longish = keys.some(k => /(parameter|component|nutrient)/.test(norm(k))) && keys.some(k => /(value|amount|content)/.test(norm(k))); return longish ? normalizeLongRows(source, rows) : normalizeWideRows(source, rows); }
function macroFromUsda(id, name, unit) {
    const n = norm(name), u = String(unit || '').toUpperCase();
    if ([1008, 2047, 2048].includes(Number(id)) || (n === 'energy' && u === 'KCAL'))
        return 'kcal';
    if (Number(id) === 1003 || n === 'protein')
        return 'protein';
    if (Number(id) === 1005 || n.includes('carbohydrate by difference'))
        return 'carbs';
    if (Number(id) === 2000 || n === 'total sugars' || n === 'sugars total including nlea')
        return 'sugar';
    if (Number(id) === 1004 || n === 'total lipid fat')
        return 'fat';
    if (Number(id) === 1258 || n.includes('fatty acids total saturated'))
        return 'saturatedFat';
    if (Number(id) === 1079 || n.includes('fiber total dietary'))
        return 'fiber';
    if (Number(id) === 1093 || n === 'sodium na')
        return 'sodium';
    return null;
}
function friendlyUsda(name) {
    const n = norm(name);
    if (n.includes('18 3 n 3') || n.includes('alpha linolenic'))
        return ['ALA', 'acido α-linolenico'];
    if (n.includes('20 5 n 3') || n.includes('eicosapentaenoic'))
        return ['EPA', 'acido eicosapentaenoico'];
    if (n.includes('22 6 n 3') || n.includes('docosahexaenoic'))
        return ['DHA', 'acido docosaesaenoico'];
    if (n.includes('18 2 n 6') || n.includes('linoleic acid'))
        return ['Acido linoleico (LA)', 'omega-6'];
    const minerals = { magnesium: ['Magnesio', 'naturalmente presente / non specificata'], iron: ['Ferro', 'naturalmente presente / non specificata'], calcium: ['Calcio', 'naturalmente presente / non specificata'], potassium: ['Potassio', 'naturalmente presente / non specificata'], zinc: ['Zinco', 'naturalmente presente / non specificata'], copper: ['Rame', 'naturalmente presente / non specificata'], selenium: ['Selenio', 'naturalmente presente / non specificata'], phosphorus: ['Fosforo', 'naturalmente presente / non specificata'] };
    for (const [k, v] of Object.entries(minerals))
        if (n.startsWith(k))
            return v;
    if (n.includes('folate food'))
        return ['Folati', 'alimentari'];
    if (n === 'folic acid')
        return ['Acido folico', 'aggiunto/sintetico'];
    if (n.includes('vitamin b 12 added'))
        return ['Vitamina B12', 'aggiunta'];
    if (n.includes('vitamin b 12'))
        return ['Vitamina B12', 'non specificata'];
    const amino = { leucine: 'Leucina', isoleucine: 'Isoleucina', valine: 'Valina', lysine: 'Lisina', methionine: 'Metionina', threonine: 'Treonina', tryptophan: 'Triptofano', histidine: 'Istidina', phenylalanine: 'Fenilalanina' };
    for (const [k, v] of Object.entries(amino))
        if (n === k)
            return [v, 'aminoacido'];
    if (n === 'fructose')
        return ['Fruttosio', 'zucchero semplice'];
    if (n === 'glucose')
        return ['Glucosio', 'zucchero semplice'];
    if (n === 'galactose')
        return ['Galattosio', 'zucchero semplice'];
    if (n === 'lactose')
        return ['Lattosio', 'disaccaride'];
    if (n === 'sucrose')
        return ['Saccarosio', 'disaccaride'];
    return [name, 'non specificata'];
}
function unitUsda(u) { const x = String(u || '').toUpperCase(); return x === 'UG' ? 'µg' : x === 'MG' ? 'mg' : x === 'G' ? 'g' : x === 'KCAL' ? 'kcal' : u || ''; }
function extractUsdaNutrient(fn) {
    const nutrient = fn?.nutrient || {};
    return { id: nutrient.id ?? fn.nutrientId ?? fn.nutrient_id, name: nutrient.name ?? fn.nutrientName ?? fn.nutrient_name, unit: nutrient.unitName ?? fn.unitName ?? fn.unit_name, amount: num(fn.amount ?? fn.value) };
}
function usdaFoodToNormalized(f, source = 'USDA_FOUNDATION') {
    const label = emptyLabel(), nutrients = [], seen = new Set();
    for (const fn of f?.foodNutrients || []) {
        const x = extractUsdaNutrient(fn);
        if (x.amount === null || !x.name)
            continue;
        const unit = unitUsda(x.unit);
        const m = macroFromUsda(x.id, x.name, unit);
        if (m) {
            if (m === 'sodium') {
                if (label.salt === '')
                    label.salt = x.amount * 2.5 / (unit === 'mg' ? 1000 : 1);
            }
            else if (label[m] === '')
                label[m] = x.amount;
            continue;
        }
        if (!unit)
            continue;
        const [display, form] = friendlyUsda(x.name);
        const dedupe = `${display}|${form}|${unit}`;
        if (seen.has(dedupe))
            continue;
        seen.add(dedupe);
        nutrients.push({ id: newId(), name: display, form, amount: x.amount, unit, source: SOURCE_META[source]?.name || 'USDA FoodData Central', sourceId: String(f.fdcId || ''), evidence: 'FoodData Central', rawName: x.name, bio: { mode: 'none', min: '', max: '', source: '' } });
    }
    const id = String(f.fdcId ?? f.fdc_id ?? '');
    const officialName = clean(f.description || f.name);
    return { localId: `${source}:${id || newId()}`, source, sourceId: id, name: officialName, officialName, brand: clean(f.brandName || f.brandOwner || ''), servingGrams: 100, label, ingredients: clean(f.ingredients || ''), nutrients, aliases: [], sourceInfo: { id: newId(), name: SOURCE_META[source]?.name || 'USDA FoodData Central', reference: `FDC ${id}`, quality: source === 'USDA_FOUNDATION' ? 'primaria' : 'secondaria', version: SOURCE_META[source]?.version || '', url: id ? `https://fdc.nal.usda.gov/fdc-app.html#/food-details/${id}/nutrients` : '' }, dataType: f.dataType || f.data_type || '' };
}
function normalizeUsdaJsonPayload(source, raw) {
    let arr = [];
    if (Array.isArray(raw))
        arr = raw;
    else if (raw && typeof raw === 'object') {
        const preferred = ['FoundationFoods', 'SRLegacyFoods', 'SurveyFoods', 'BrandedFoods', 'foods'];
        for (const k of preferred)
            if (Array.isArray(raw[k])) {
                arr = raw[k];
                break;
            }
        if (!arr.length) {
            const candidate = Object.values(raw).find(v => Array.isArray(v) && v.length && typeof v[0] === 'object');
            if (candidate)
                arr = candidate;
        }
    }
    return arr.map(f => usdaFoodToNormalized(f, source)).filter(f => f.name);
}
function rowVal(r, aliases) { for (const [k, v] of Object.entries(r || {}))
    if (aliases.some(a => norm(k) === norm(a)))
        return v; return undefined; }
function normalizeUsdaCsvTables(source, foodRows, nutrientRows, foodNutrientRows) {
    const nutrientMap = new Map();
    for (const r of nutrientRows || []) {
        const id = String(rowVal(r, ['id', 'nutrient_id']) ?? '');
        if (id)
            nutrientMap.set(id, { id, name: rowVal(r, ['name', 'nutrient_name']), unitName: rowVal(r, ['unit_name', 'unit']) });
    }
    const foodMap = new Map();
    for (const r of foodRows || []) {
        const id = String(rowVal(r, ['fdc_id', 'fdc id']) ?? '');
        const description = clean(rowVal(r, ['description', 'food description', 'name']));
        if (id && description)
            foodMap.set(id, { fdcId: id, description, dataType: rowVal(r, ['data_type', 'data type']), foodNutrients: [] });
    }
    for (const r of foodNutrientRows || []) {
        const fdc = String(rowVal(r, ['fdc_id', 'fdc id']) ?? ''), nid = String(rowVal(r, ['nutrient_id', 'nutrient id']) ?? '');
        const f = foodMap.get(fdc), n = nutrientMap.get(nid);
        if (!f || !n)
            continue;
        const amount = num(rowVal(r, ['amount', 'value']));
        if (amount === null)
            continue;
        f.foodNutrients.push({ nutrient: n, amount });
    }
    return [...foodMap.values()].map(f => usdaFoodToNormalized(f, source));
}
function scoreFood(q, f) {
    const name = norm(`${f.name || ''} ${f.officialName || ''}`), brand = norm(f.brand), aliases = (f.aliases || []).map(norm);
    if (!norm(q))
        return 0;
    let s = 0;
    for (const p of phraseAlternatives(q)) {
        if (name === p)
            s = Math.max(s, 120);
        else if (name.startsWith(p))
            s = Math.max(s, 65);
        else if (name.includes(p))
            s = Math.max(s, 48);
        if (aliases.includes(p))
            s = Math.max(s, 150);
    }
    for (const token of queryTokens(q)) {
        const alts = tokenAlternatives(token);
        if (alts.some(a => name.includes(a)))
            s += 14;
        else
            s -= 4;
        if (alts.some(a => aliases.some(x => x.includes(a))))
            s += 25;
    }
    if (brand && norm(q) === brand)
        s += 8;
    // Le fonti generiche/scientifiche hanno un piccolo vantaggio nella ricerca quotidiana.
    if (f.source === 'USDA_FOUNDATION')
        s += 8;
    else if (f.source === 'USDA_SR')
        s += 5;
    return Math.max(0, s);
}
function searchLocalDataset(q, datasets, limit = 12) { const all = []; for (const [source, foods] of Object.entries(datasets || {}))
    for (const f of foods || []) {
        const score = scoreFood(q, f);
        if (score > 0)
            all.push({ ...f, score, source });
    } return all.sort((a, b) => b.score - a.score || String(a.name).localeCompare(String(b.name))).slice(0, limit); }
function searchPersonalFoods(q, foods, limit = 8) { return (foods || []).map(f => ({ ...f, score: scoreFood(q, f), resultType: 'personal' })).filter(f => f.score > 0).sort((a, b) => b.score - a.score).slice(0, limit); }
const BASE_GOALS = [
    { id: 'kcal', name: 'Energia', unit: 'kcal', target: 2400, period: 'day', kind: 'target' },
    { id: 'protein', name: 'Proteine', unit: 'g', target: 160, period: 'day', kind: 'target' },
    { id: 'carbs', name: 'Carboidrati', unit: 'g', target: 260, period: 'day', kind: 'target' },
    { id: 'fat', name: 'Grassi', unit: 'g', target: 75, period: 'day', kind: 'target' },
    { id: 'fiber', name: 'Fibre', unit: 'g', target: 35, period: 'day', kind: 'minimum' },
    { id: 'Magnesio', name: 'Magnesio', form: '*', unit: 'mg', target: 400, period: 'day', kind: 'minimum' },
    { id: 'Ferro', name: 'Ferro', form: '*', unit: 'mg', target: 10, period: 'day', kind: 'minimum' },
    { id: 'Calcio', name: 'Calcio', form: '*', unit: 'mg', target: 1000, period: 'day', kind: 'minimum' },
    { id: 'Potassio', name: 'Potassio', form: '*', unit: 'mg', target: 3500, period: 'day', kind: 'minimum' },
    { id: 'Zinco', name: 'Zinco', form: '*', unit: 'mg', target: 11, period: 'day', kind: 'minimum' },
    { id: 'EPA', name: 'EPA', form: '*', unit: 'mg', target: 1750, period: 'week', kind: 'minimum' },
    { id: 'DHA', name: 'DHA', form: '*', unit: 'mg', target: 1750, period: 'week', kind: 'minimum' }
];
const MACROS = { kcal: 'Calorie (kcal)', protein: 'Proteine (g)', carbs: 'Carboidrati (g)', sugar: 'Zuccheri (g)', fat: 'Grassi (g)', saturatedFat: 'Saturi (g)', fiber: 'Fibre (g)', salt: 'Sale (g)' };
const EAA = ['Leucina', 'Isoleucina', 'Valina', 'Lisina', 'Metionina', 'Treonina', 'Triptofano', 'Istidina', 'Fenilalanina'];
const emptyFood = () => ({ id: crypto.randomUUID(), name: '', brand: '', servingGrams: 100, label: Object.fromEntries(Object.keys(MACROS).map(k => [k, ''])), ingredients: '', additives: [], nutrients: [], sources: [], notes: '', mergeMeta: null });
const emptyNutrient = () => ({ id: crypto.randomUUID(), name: '', form: '', amount: '', unit: 'mg', source: 'Etichetta', evidence: 'dichiarato', elementalAmount: '', bio: { mode: 'none', min: '', max: '', source: '' } });
const fmt = (n, d = 1) => Number(n || 0).toLocaleString('it-IT', { maximumFractionDigits: d });
const dateKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const startOfWeek = () => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); d.setHours(0, 0, 0, 0); return d; };
const parseAdditives = t => [...new Set((String(t).toUpperCase().match(/\bE\s?\d{3,4}[A-Z]?\b/g) || []).map(x => x.replace(/\s/g, '')))];
const unitFactor = u => u === 'g' ? 1000 : u === 'µg' ? 0.001 : u === 'mg' ? 1 : 1;
const convert = (v, from, to) => Number(v || 0) * unitFactor(from) / unitFactor(to);
function aggregate(logs, foods) {
    const o = { kcal: 0, protein: 0, carbs: 0, sugar: 0, fat: 0, saturatedFat: 0, fiber: 0, salt: 0, nutrients: {} };
    for (const l of logs) {
        const f = foods.find(x => x.id === l.foodId);
        if (!f)
            continue;
        const q = Number(l.grams) / (Number(f.servingGrams) || 100);
        for (const k of Object.keys(MACROS))
            o[k] += (Number(f.label?.[k]) || 0) * q;
        for (const n of f.nutrients || []) {
            const key = `${n.name}|${n.form || 'non specificata'}|${n.unit}`;
            if (!o.nutrients[key])
                o.nutrients[key] = { amount: 0, absorbedMin: 0, absorbedMax: 0, hasBio: false, sources: new Set() };
            const z = o.nutrients[key];
            z.amount += (Number(n.amount) || 0) * q;
            z.sources.add(n.source || 'non specificata');
            const elemental = n.elementalAmount !== '' && n.elementalAmount != null ? Number(n.elementalAmount) : Number(n.amount) || 0;
            const b = n.bio || {};
            if (b.mode === 'fixed' || b.mode === 'range') {
                const min = Number(b.min) || 0, max = Number(b.max || b.min) || 0;
                z.absorbedMin += elemental * q * min / 100;
                z.absorbedMax += elemental * q * max / 100;
                z.hasBio = true;
            }
        }
    }
    return o;
}
function nutrientTotal(ag, name, toUnit = 'mg', form = '*') { let sum = 0; for (const [k, v] of Object.entries(ag.nutrients)) {
    const [n, f, u] = k.split('|');
    if (n.toLowerCase() === name.toLowerCase() && (form === '*' || !form || f.toLowerCase() === form.toLowerCase()))
        sum += convert(v.amount, u, toUnit);
} return sum; }
function absorbedTotal(ag, name, toUnit = 'mg') { let min = 0, max = 0, has = false; for (const [k, v] of Object.entries(ag.nutrients)) {
    const [n, , u] = k.split('|');
    if (n.toLowerCase() !== name.toLowerCase() || !v.hasBio)
        continue;
    min += convert(v.absorbedMin, u, toUnit);
    max += convert(v.absorbedMax, u, toUnit);
    has = true;
} return { min, max, has }; }
function Progress({ value, goal, unit, kind = 'target' }) { const pct = goal ? Math.min(100, value / goal * 100) : 0; const warn = kind === 'upper' && value > goal; return React.createElement("div", { className: "progressBlock" },
    React.createElement("div", { className: "progressTop" },
        React.createElement("strong", null, fmt(value, 2)),
        React.createElement("span", null,
            "/ ",
            fmt(goal, 2),
            " ",
            unit)),
    React.createElement("div", { className: `bar ${warn ? 'over' : ''}` },
        React.createElement("span", { style: { width: `${pct}%` } })),
    React.createElement("small", { className: "goalKind" }, kind === 'minimum' ? 'minimo' : kind === 'upper' ? 'limite massimo' : 'obiettivo')); }
function openDb() { return new Promise((res, rej) => { const r = indexedDB.open('nutritrace-db', 1); r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains('datasets'))
    r.result.createObjectStore('datasets'); }; r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
async function dbSet(k, v) { const db = await openDb(); return new Promise((res, rej) => { const tx = db.transaction('datasets', 'readwrite'); tx.objectStore('datasets').put(v, k); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); }); }
async function dbGet(k) { const db = await openDb(); return new Promise((res, rej) => { const r = db.transaction('datasets').objectStore('datasets').get(k); r.onsuccess = () => res(r.result || []); r.onerror = () => rej(r.error); }); }
async function dbDel(k) { const db = await openDb(); return new Promise((res, rej) => { const tx = db.transaction('datasets', 'readwrite'); tx.objectStore('datasets').delete(k); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); }); }
async function searchUsdaBranded(q, key) {
    const url = new URL('https://api.nal.usda.gov/fdc/v1/foods/search');
    url.searchParams.set('api_key', (key || 'DEMO_KEY').trim() || 'DEMO_KEY');
    url.searchParams.set('query', q);
    url.searchParams.set('dataType', 'Branded');
    url.searchParams.set('pageSize', '15');
    const r = await fetch(url);
    if (!r.ok)
        throw new Error(`USDA ${r.status}`);
    const d = await r.json();
    return (d.foods || []).map(f => ({ resultType: 'branded', source: 'USDA_BRANDED', sourceId: String(f.fdcId), name: f.description, brand: f.brandName || f.brandOwner || '', ingredients: f.ingredients || '', dataType: f.dataType || 'Branded' }));
}
async function fetchUsdaBrandedFood(id, key) { const r = await fetch(`https://api.nal.usda.gov/fdc/v1/food/${encodeURIComponent(id)}?api_key=${encodeURIComponent((key || 'DEMO_KEY').trim() || 'DEMO_KEY')}`); if (!r.ok)
    throw new Error(`USDA ${r.status}`); return usdaFoodToNormalized(await r.json(), 'USDA_BRANDED'); }
function parseSheetRows(data, type = 'array') { const wb = XLSX.read(data, { type }); let rows = []; for (const sn of wb.SheetNames) {
    const a = XLSX.utils.sheet_to_json(wb.Sheets[sn], { defval: '' });
    if (a.length)
        rows.push(...a);
} return rows; }
function Home() {
    const [foods, setFoods] = useState([]), [logs, setLogs] = useState([]), [goals, setGoals] = useState(BASE_GOALS), [profile, setProfile] = useState({ weight: 80, proteinPerKg: 2, fatPerKg: .8, kcal: 2400 });
    const [tab, setTab] = useState('oggi'), [foodDraft, setFoodDraft] = useState(null), [selectedFoodId, setSelectedFoodId] = useState(''), [grams, setGrams] = useState(100), [loaded, setLoaded] = useState(false);
    const [query, setQuery] = useState(''), [searching, setSearching] = useState(false), [results, setResults] = useState([]), [searchError, setSearchError] = useState(''), [importing, setImporting] = useState('');
    const [quickQuery, setQuickQuery] = useState(''), [commercialOnline, setCommercialOnline] = useState(false), [usdaApiKey, setUsdaApiKey] = useState('');
    const [datasets, setDatasets] = useState({ USDA_FOUNDATION: [], USDA_SR: [], CIQUAL: [], FRIDA: [], COFID: [] }), [datasetStatus, setDatasetStatus] = useState({}), [datasetMsg, setDatasetMsg] = useState('');
    useEffect(() => { try {
        setFoods(JSON.parse(localStorage.getItem('nutritrace_foods') || '[]'));
        setLogs(JSON.parse(localStorage.getItem('nutritrace_logs') || '[]'));
        setGoals(JSON.parse(localStorage.getItem('nutritrace_goals_v3') || 'null') || BASE_GOALS);
        setProfile(JSON.parse(localStorage.getItem('nutritrace_profile') || 'null') || profile);
        setCommercialOnline(localStorage.getItem('nutritrace_commercial_online') === '1');
        setUsdaApiKey(localStorage.getItem('nutritrace_usda_key') || '');
    }
    finally {
        setLoaded(true);
    } ; if ('serviceWorker' in navigator)
        navigator.serviceWorker.register('/sw.js').catch(() => { }); (async () => { const obj = {}; const st = {}; for (const source of SCIENTIFIC_SOURCES) {
        obj[source] = await dbGet(source);
        st[source] = obj[source].length;
    } setDatasets(obj); setDatasetStatus(st); })(); }, []);
    useEffect(() => { if (loaded)
        localStorage.setItem('nutritrace_foods', JSON.stringify(foods)); }, [foods, loaded]);
    useEffect(() => { if (loaded)
        localStorage.setItem('nutritrace_logs', JSON.stringify(logs)); }, [logs, loaded]);
    useEffect(() => { if (loaded)
        localStorage.setItem('nutritrace_goals_v3', JSON.stringify(goals)); }, [goals, loaded]);
    useEffect(() => { if (loaded)
        localStorage.setItem('nutritrace_profile', JSON.stringify(profile)); }, [profile, loaded]);
    useEffect(() => { if (loaded)
        localStorage.setItem('nutritrace_commercial_online', commercialOnline ? '1' : '0'); }, [commercialOnline, loaded]);
    useEffect(() => { if (loaded)
        localStorage.setItem('nutritrace_usda_key', usdaApiKey); }, [usdaApiKey, loaded]);
    const todayLogs = logs.filter(l => l.date === dateKey()), weekLogs = logs.filter(l => new Date(`${l.date}T12:00:00`) >= startOfWeek());
    const totals = useMemo(() => aggregate(todayLogs, foods), [todayLogs, foods]), weekTotals = useMemo(() => aggregate(weekLogs, foods), [weekLogs, foods]);
    const omega = { ala: nutrientTotal(totals, 'ALA', 'mg'), epa: nutrientTotal(totals, 'EPA', 'mg'), dha: nutrientTotal(totals, 'DHA', 'mg') };
    const eaa = Object.fromEntries(EAA.map(n => [n, nutrientTotal(totals, n, 'g')]));
    const recentIds = [...logs].reverse().map(l => l.foodId).filter((id, i, a) => a.indexOf(id) === i).slice(0, 6);
    const quickSuggestions = useMemo(() => { if (!quickQuery.trim())
        return recentIds.map(id => foods.find(f => f.id === id)).filter(Boolean).map(f => ({ ...f, resultType: 'personal' })); const personal = searchPersonalFoods(quickQuery, foods, 5), local = searchLocalDataset(quickQuery, datasets, 7).map(f => ({ ...f, resultType: 'local' })); return [...personal, ...local].slice(0, 8); }, [quickQuery, foods, datasets, logs]);
    function valueForGoal(g, ag) { if (Object.keys(MACROS).includes(g.id))
        return ag[g.id] || 0; return nutrientTotal(ag, g.name, g.unit, g.form || '*'); }
    function saveFood() { if (!foodDraft?.name.trim())
        return; const f = { ...foodDraft, additives: parseAdditives(foodDraft.ingredients) }; setFoods(p => [...p.filter(x => x.id !== f.id), f]); setFoodDraft(null); }
    function addLog() { if (!selectedFoodId || Number(grams) <= 0)
        return; setLogs(p => [...p, { id: crypto.randomUUID(), date: dateKey(), foodId: selectedFoodId, grams: Number(grams) }]); }
    async function searchFoods() { if (!query.trim())
        return; setSearching(true); setSearchError(''); try {
        const local = searchLocalDataset(query, datasets, 24).map(f => ({ ...f, resultType: 'local' }));
        let online = [];
        if (commercialOnline) {
            try {
                online = await searchUsdaBranded(query, usdaApiKey);
            }
            catch (e) {
                setSearchError(`Prodotti commerciali online non disponibili: ${e.message}. I database scientifici locali continuano a funzionare.`);
            }
        }
        setResults([...local, ...online].slice(0, 36));
    }
    finally {
        setSearching(false);
    } }
    function materializeImported(f, alias = '') { const source = f.sourceInfo || f.source; const useAlias = alias.trim() && f.source !== 'USDA_BRANDED'; return { ...emptyFood(), source: f.source || '', sourceId: f.sourceId || '', name: useAlias ? alias.trim() : f.name, officialName: f.officialName || f.name, aliases: [...new Set([...(f.aliases || []), ...(useAlias ? [alias.trim()] : [])])], brand: f.brand || '', servingGrams: f.servingGrams || 100, label: f.label || emptyFood().label, ingredients: f.ingredients || '', nutrients: f.nutrients || [], sources: [source], mergeMeta: { importedFrom: f.source || source?.name } }; }
    function openImported(f, alias = query) { const same = foods.find(z => (z.sourceId && z.sourceId === f.sourceId) || (z.name.toLowerCase() === f.name.toLowerCase() && (z.brand || '').toLowerCase() === (f.brand || '').toLowerCase())); const source = f.sourceInfo || f.source; if (same)
        setFoodDraft({ ...structuredClone(same), aliases: [...new Set([...(same.aliases || []), ...(alias.trim() ? [alias.trim()] : [])])], sources: [...(same.sources || []), source], nutrients: [...(same.nutrients || []), ...(f.nutrients || [])], mergeMeta: { mode: 'review', candidate: f } });
    else
        setFoodDraft(materializeImported(f, alias)); setTab('alimenti'); }
    async function importResult(r) { if (r.resultType === 'local') {
        openImported(r, query);
        return;
    } setImporting(r.sourceId); setSearchError(''); try {
        const f = await fetchUsdaBrandedFood(r.sourceId, usdaApiKey);
        openImported(f, '');
    }
    catch (e) {
        setSearchError(e.message);
    }
    finally {
        setImporting('');
    } }
    function addFoodLog(foodId, g = grams) { if (!foodId || Number(g) <= 0)
        return; setLogs(p => [...p, { id: crypto.randomUUID(), date: dateKey(), foodId, grams: Number(g) }]); }
    function quickAdd(r) { if (Number(grams) <= 0)
        return; if (r.resultType === 'personal') {
        addFoodLog(r.id);
        setQuickQuery('');
        return;
    } const f = materializeImported(r, quickQuery || r.name); setFoods(p => [...p, f]); setLogs(p => [...p, { id: crypto.randomUUID(), date: dateKey(), foodId: f.id, grams: Number(grams) }]); setQuickQuery(''); }
    function applyPerKg() { setGoals(gs => gs.map(g => g.id === 'kcal' ? { ...g, target: Number(profile.kcal) } : g.id === 'protein' ? { ...g, target: Number(profile.weight) * Number(profile.proteinPerKg) } : g.id === 'fat' ? { ...g, target: Number(profile.weight) * Number(profile.fatPerKg) } : g)); }
    function exportData() { const b = new Blob([JSON.stringify({ version: 3, foods, logs, goals, profile }, null, 2)], { type: 'application/json' }), u = URL.createObjectURL(b), a = document.createElement('a'); a.href = u; a.download = `nutritrace-${dateKey()}.json`; a.click(); URL.revokeObjectURL(u); }
    function importBackup(e) { const f = e.target.files?.[0]; if (!f)
        return; const rd = new FileReader(); rd.onload = () => { try {
        const d = JSON.parse(rd.result);
        if (d.foods)
            setFoods(d.foods);
        if (d.logs)
            setLogs(d.logs);
        if (d.goals)
            setGoals(d.goals);
        if (d.profile)
            setProfile(d.profile);
    }
    catch {
        alert('Backup non valido');
    } }; rd.readAsText(f); }
    async function importDataset(source, file) {
        setDatasetMsg(`Importazione ${SOURCE_META[source]?.name || source}…`);
        try {
            const buf = await file.arrayBuffer();
            let normalized = [];
            const lower = file.name.toLowerCase();
            if (source === 'USDA_FOUNDATION' || source === 'USDA_SR') {
                if (lower.endsWith('.json'))
                    normalized = normalizeUsdaJsonPayload(source, JSON.parse(new TextDecoder().decode(buf)));
                else if (lower.endsWith('.zip')) {
                    const files = unzipSync(new Uint8Array(buf));
                    const names = Object.keys(files);
                    const jsonName = names.find(n => n.toLowerCase().endsWith('.json'));
                    if (jsonName)
                        normalized = normalizeUsdaJsonPayload(source, JSON.parse(strFromU8(files[jsonName])));
                    else {
                        const foodName = names.find(n => /(^|\/)food\.csv$/i.test(n)), nutName = names.find(n => /(^|\/)nutrient\.csv$/i.test(n)), fnName = names.find(n => /(^|\/)food_nutrient\.csv$/i.test(n));
                        if (!foodName || !nutName || !fnName)
                            throw new Error('Archivio USDA non riconosciuto. Usa il download JSON o CSV ufficiale del singolo dataset.');
                        const foodRows = parseSheetRows(strFromU8(files[foodName]), 'string'), nutRows = parseSheetRows(strFromU8(files[nutName]), 'string'), fnRows = parseSheetRows(strFromU8(files[fnName]), 'string');
                        normalized = normalizeUsdaCsvTables(source, foodRows, nutRows, fnRows);
                    }
                }
                else
                    throw new Error('Per USDA usa il file JSON o ZIP ufficiale.');
            }
            else
                normalized = normalizeRows(source, parseSheetRows(buf, 'array'));
            if (!normalized.length)
                throw new Error('Formato non riconosciuto o nessun alimento trovato.');
            await dbSet(source, normalized);
            setDatasets(d => ({ ...d, [source]: normalized }));
            setDatasetStatus(st => ({ ...st, [source]: normalized.length }));
            setDatasetMsg(`${SOURCE_META[source].name}: ${normalized.length} alimenti indicizzati e disponibili offline.`);
        }
        catch (e) {
            setDatasetMsg(`Errore ${source}: ${e.message}`);
        }
    }
    async function removeDataset(source) { await dbDel(source); setDatasets(d => ({ ...d, [source]: [] })); setDatasetStatus(s => ({ ...s, [source]: 0 })); setDatasetMsg(`${source} rimosso.`); }
    const addNutrient = () => setFoodDraft({ ...foodDraft, nutrients: [...(foodDraft.nutrients || []), emptyNutrient()] });
    function editNutrient(i, patch) { const a = [...foodDraft.nutrients]; a[i] = { ...a[i], ...patch }; setFoodDraft({ ...foodDraft, nutrients: a }); }
    return React.createElement("main", null,
        React.createElement("header", { className: "hero" },
            React.createElement("div", null,
                React.createElement("div", { className: "eyebrow" }, "DIARIO NUTRIZIONALE PERSONALE \u00B7 V1.1 LOCAL-FIRST"),
                React.createElement("h1", null, "NutriTrace"),
                React.createElement("p", null, "Quantit\u00E0, forme chimiche, ingredienti, biodisponibilit\u00E0 e provenienza del dato.")),
            React.createElement("div", { className: "privacy" }, "\u25CF Local-first \u00B7 dati sul dispositivo")),
        React.createElement("nav", { className: "tabs" }, ['oggi', 'ricerca', 'alimenti', 'obiettivi', 'dati'].map(x => React.createElement("button", { key: x, className: tab === x ? 'active' : '', onClick: () => setTab(x) }, x[0].toUpperCase() + x.slice(1)))),
        tab === 'oggi' && React.createElement("section", null,
            React.createElement("div", { className: "grid5" }, [['kcal', 'Energia', 'kcal'], ['protein', 'Proteine', 'g'], ['carbs', 'Carboidrati', 'g'], ['fat', 'Grassi', 'g'], ['fiber', 'Fibre', 'g']].map(([id, n, u], i) => { const g = goals.find(x => x.id === id); return React.createElement("article", { className: `metric ${i === 0 ? 'primary' : ''}`, key: id },
                React.createElement("span", null, n),
                React.createElement(Progress, { value: totals[id], goal: g?.target || 0, unit: u, kind: g?.kind })); })),
            React.createElement("div", { className: "twoCol" },
                React.createElement("article", { className: "card quickDiary" },
                    React.createElement("h2", null, "Scrivi cosa hai mangiato"),
                    React.createElement("p", { className: "muted" }, "Niente marca obbligatoria: prova semplicemente \u201Cpasta integrale\u201D, \u201Cmela\u201D, \u201Cpollo\u201D\u2026"),
                    React.createElement("div", { className: "quickInputs" },
                        React.createElement("input", { value: quickQuery, onChange: e => setQuickQuery(e.target.value), placeholder: "Alimento generico\u2026" }),
                        React.createElement("label", null,
                            "grammi",
                            React.createElement("input", { type: "number", inputMode: "decimal", value: grams, onChange: e => setGrams(e.target.value) }))),
                    React.createElement("div", { className: "quickSuggestions" }, quickSuggestions.map((r, i) => React.createElement("button", { className: "quickChoice", key: `${r.resultType}-${r.id || r.localId || i}`, onClick: () => quickAdd(r) },
                        React.createElement("span", null,
                            React.createElement("b", null, r.resultType === 'personal' ? r.name : (quickQuery || r.name)),
                            React.createElement("small", null, r.resultType === 'personal' ? 'Già nel tuo archivio' : `${r.name} · ${SOURCE_META[r.source]?.name || r.source}`)),
                        React.createElement("strong", null,
                            "+ ",
                            grams,
                            " g")))),
                    quickQuery.trim() && !quickSuggestions.length && React.createElement("button", { className: "ghost", onClick: () => { setFoodDraft({ ...emptyFood(), name: quickQuery.trim(), aliases: [quickQuery.trim()] }); setTab('alimenti'); } },
                        "Crea \u201C",
                        quickQuery.trim(),
                        "\u201D manualmente"),
                    React.createElement("details", { className: "archiveFallback" },
                        React.createElement("summary", null, "Scegli dall\u2019archivio personale"),
                        foods.length ? React.createElement("div", { className: "archiveInline" },
                            React.createElement("select", { value: selectedFoodId, onChange: e => setSelectedFoodId(e.target.value) },
                                React.createElement("option", { value: "" }, "Seleziona\u2026"),
                                foods.map(f => React.createElement("option", { key: f.id, value: f.id },
                                    f.name,
                                    f.brand ? ` — ${f.brand}` : ''))),
                            React.createElement("button", { className: "ghost", onClick: addLog }, "Aggiungi")) : React.createElement("small", null, "Nessun alimento salvato."))),
                React.createElement("article", { className: "card" },
                    React.createElement("h2", null, "Dettaglio di oggi"),
                    React.createElement("div", { className: "miniGrid" },
                        React.createElement("div", null,
                            React.createElement("small", null, "Zuccheri"),
                            React.createElement("strong", null,
                                fmt(totals.sugar),
                                " g")),
                        React.createElement("div", null,
                            React.createElement("small", null, "Saturi"),
                            React.createElement("strong", null,
                                fmt(totals.saturatedFat),
                                " g")),
                        React.createElement("div", null,
                            React.createElement("small", null, "Sale"),
                            React.createElement("strong", null,
                                fmt(totals.salt),
                                " g")),
                        React.createElement("div", null,
                            React.createElement("small", null, "Voci"),
                            React.createElement("strong", null, todayLogs.length))))),
            React.createElement("div", { className: "twoCol" },
                React.createElement("article", { className: "card" },
                    React.createElement("h2", null, "Omega\u20113"),
                    React.createElement("div", { className: "miniGrid" },
                        React.createElement("div", null,
                            React.createElement("small", null, "ALA"),
                            React.createElement("strong", null,
                                fmt(omega.ala, 2),
                                " mg")),
                        React.createElement("div", null,
                            React.createElement("small", null, "EPA"),
                            React.createElement("strong", null,
                                fmt(omega.epa, 2),
                                " mg")),
                        React.createElement("div", null,
                            React.createElement("small", null, "DHA"),
                            React.createElement("strong", null,
                                fmt(omega.dha, 2),
                                " mg")),
                        React.createElement("div", null,
                            React.createElement("small", null, "EPA + DHA"),
                            React.createElement("strong", null,
                                fmt(omega.epa + omega.dha, 2),
                                " mg"))),
                    React.createElement("p", { className: "muted tiny" }, "ALA, EPA e DHA restano separati: l\u2019app non trasforma automaticamente ALA in EPA/DHA.")),
                React.createElement("article", { className: "card" },
                    React.createElement("h2", null, "Aminoacidi essenziali"),
                    React.createElement("div", { className: "aminoGrid" }, EAA.map(n => React.createElement("div", { key: n },
                        React.createElement("small", null, n),
                        React.createElement("b", null,
                            fmt(eaa[n], 2),
                            " g")))))),
            React.createElement("article", { className: "card" },
                React.createElement("h2", null, "Alimenti consumati"),
                !todayLogs.length ? React.createElement("p", { className: "empty" }, "Nessun alimento oggi.") : React.createElement("div", { className: "list" }, todayLogs.map(l => { const f = foods.find(x => x.id === l.foodId); return React.createElement("div", { className: "row", key: l.id },
                    React.createElement("div", null,
                        React.createElement("strong", null, f?.name || 'Alimento eliminato'),
                        React.createElement("small", null, f?.brand || '')),
                    React.createElement("span", null,
                        l.grams,
                        " g"),
                    React.createElement("button", { className: "ghost danger", onClick: () => setLogs(logs.filter(x => x.id !== l.id)) }, "Rimuovi")); }))),
            React.createElement("article", { className: "card" },
                React.createElement("h2", null, "Micronutrienti, forme e quota assorbibile"),
                !Object.keys(totals.nutrients).length ? React.createElement("p", { className: "empty" }, "Nessun micronutriente registrato.") : React.createElement("div", { className: "nutriTable" }, Object.entries(totals.nutrients).sort().map(([k, v]) => { const [n, form, unit] = k.split('|'); return React.createElement("div", { className: "bioRow", key: k },
                    React.createElement("div", null,
                        React.createElement("strong", null, n),
                        React.createElement("small", null, form)),
                    React.createElement("b", null,
                        fmt(v.amount, 2),
                        " ",
                        unit),
                    React.createElement("span", null, v.hasBio ? `assorbibile stimato ${fmt(v.absorbedMin, 2)}–${fmt(v.absorbedMax, 2)} ${unit}` : 'assorbimento non stimato')); })))),
        tab === 'ricerca' && React.createElement("section", null,
            React.createElement("div", { className: "sectionHead" },
                React.createElement("div", null,
                    React.createElement("h2", null, "Ricerca alimenti"),
                    React.createElement("p", null, "Prima i database scientifici salvati sul dispositivo. I prodotti di marca online sono facoltativi."))),
            React.createElement("article", { className: "card" },
                React.createElement("div", { className: "searchBox" },
                    React.createElement("input", { value: query, onChange: e => setQuery(e.target.value), onKeyDown: e => e.key === 'Enter' && searchFoods(), placeholder: "es. pasta integrale, salmone, lenticchie\u2026" }),
                    React.createElement("button", { className: "cta", onClick: searchFoods, disabled: searching }, searching ? 'Ricerca…' : 'Cerca')),
                searchError && React.createElement("p", { className: "errorText" }, searchError),
                React.createElement("div", { className: "sourceBadges" }, SCIENTIFIC_SOURCES.map(source => React.createElement("span", { key: source, className: datasetStatus[source] ? 'online' : '' },
                    source.replace('USDA_', 'USDA '),
                    " \u00B7 ",
                    datasetStatus[source] ? `${datasetStatus[source]} alimenti offline` : 'da installare'))),
                results.map((r, i) => React.createElement("div", { className: "searchResult", key: `${r.resultType}-${r.sourceId || r.localId}-${i}` },
                    React.createElement("div", null,
                        React.createElement("strong", null, r.name),
                        React.createElement("small", null,
                            r.brand || '',
                            r.brand ? ' · ' : '',
                            r.resultType === 'local' ? SOURCE_META[r.source]?.name : 'USDA Branded online')),
                    React.createElement("button", { className: "ghost", disabled: importing === r.sourceId, onClick: () => importResult(r) }, importing === r.sourceId ? 'Carico…' : 'Salva nel mio archivio')))),
            React.createElement("article", { className: "card onlineOptional" },
                React.createElement("div", { className: "toggleRow" },
                    React.createElement("div", null,
                        React.createElement("b", null, "Prodotti commerciali USDA online"),
                        React.createElement("p", { className: "muted" }, "Opzionale. Utile solo quando vuoi cercare una marca/prodotto specifico; il diario normale non ne ha bisogno.")),
                    React.createElement("label", { className: "switchLine" },
                        React.createElement("input", { type: "checkbox", checked: commercialOnline, onChange: e => setCommercialOnline(e.target.checked) }),
                        " Attiva")),
                commercialOnline && React.createElement("label", null,
                    "API key USDA facoltativa ",
                    React.createElement("input", { type: "password", value: usdaApiKey, onChange: e => setUsdaApiKey(e.target.value), placeholder: "vuoto = DEMO_KEY" }),
                    React.createElement("small", null, "Resta memorizzata solo su questo dispositivo."))),
            React.createElement("article", { className: "card notice" },
                React.createElement("b", null, "Uso quotidiano semplice"),
                React.createElement("p", null, "Quando selezioni per la prima volta un alimento scientifico cercando, per esempio, \u201Cpasta integrale\u201D, NutriTrace salva quel testo come alias personale. Da quel momento puoi continuare a scrivere semplicemente \u201Cpasta integrale\u201D, senza marca e senza ripetere i dettagli della fonte."))),
        tab === 'alimenti' && React.createElement("section", null,
            React.createElement("div", { className: "sectionHead" },
                React.createElement("div", null,
                    React.createElement("h2", null, "Archivio alimenti"),
                    React.createElement("p", null, "Etichetta, ingredienti, micronutrienti, forme e fonti.")),
                React.createElement("button", { className: "cta", onClick: () => setFoodDraft(emptyFood()) }, "+ Nuovo alimento")),
            !foods.length ? React.createElement("article", { className: "card empty" }, "Non hai ancora alimenti.") : React.createElement("div", { className: "foodCards" }, foods.map(f => React.createElement("article", { className: "card", key: f.id },
                React.createElement("div", { className: "cardTitle" },
                    React.createElement("div", null,
                        React.createElement("h3", null, f.name),
                        React.createElement("p", null,
                            f.brand || 'Senza marca',
                            " \u00B7 per ",
                            f.servingGrams,
                            " g")),
                    React.createElement("button", { className: "ghost", onClick: () => setFoodDraft(structuredClone(f)) }, "Modifica")),
                React.createElement("div", { className: "macroLine" },
                    React.createElement("span", null,
                        fmt(f.label.kcal),
                        " kcal"),
                    React.createElement("span", null,
                        "P ",
                        fmt(f.label.protein),
                        " g"),
                    React.createElement("span", null,
                        "C ",
                        fmt(f.label.carbs),
                        " g"),
                    React.createElement("span", null,
                        "G ",
                        fmt(f.label.fat),
                        " g")),
                f.additives?.length > 0 && React.createElement("div", { className: "chips" }, f.additives.map(a => React.createElement("span", { key: a }, a))),
                React.createElement("small", { className: "sourceText" },
                    "Fonti: ",
                    f.sources?.length ? f.sources.map(s => s?.name || s).join(', ') : 'manuale'))))),
        tab === 'obiettivi' && React.createElement("section", null,
            React.createElement("div", { className: "twoCol" },
                React.createElement("article", { className: "card" },
                    React.createElement("h2", null, "Calcolo per peso corporeo"),
                    React.createElement("div", { className: "formGrid" },
                        React.createElement("label", null,
                            "Peso (kg)",
                            React.createElement("input", { type: "number", step: "any", value: profile.weight, onChange: e => setProfile({ ...profile, weight: e.target.value }) })),
                        React.createElement("label", null,
                            "Proteine (g/kg)",
                            React.createElement("input", { type: "number", step: "any", value: profile.proteinPerKg, onChange: e => setProfile({ ...profile, proteinPerKg: e.target.value }) })),
                        React.createElement("label", null,
                            "Grassi (g/kg)",
                            React.createElement("input", { type: "number", step: "any", value: profile.fatPerKg, onChange: e => setProfile({ ...profile, fatPerKg: e.target.value }) })),
                        React.createElement("label", null,
                            "Calorie target",
                            React.createElement("input", { type: "number", value: profile.kcal, onChange: e => setProfile({ ...profile, kcal: e.target.value }) }))),
                    React.createElement("button", { className: "cta", onClick: applyPerKg }, "Applica ai target")),
                React.createElement("article", { className: "card" },
                    React.createElement("h2", null, "Stato settimanale"),
                    goals.filter(g => g.period === 'week').map(g => React.createElement("div", { key: g.id, className: "goalStatus" },
                        React.createElement("span", null, g.name),
                        React.createElement(Progress, { value: valueForGoal(g, weekTotals), goal: g.target, unit: g.unit, kind: g.kind }))))),
            React.createElement("article", { className: "card" },
                React.createElement("div", { className: "cardTitle" },
                    React.createElement("div", null,
                        React.createElement("h2", null, "Obiettivi nutrienti"),
                        React.createElement("p", null, "Minimo, target o limite massimo; giornaliero o settimanale; anche per forma specifica.")),
                    React.createElement("button", { className: "ghost", onClick: () => setGoals([...goals, { id: crypto.randomUUID(), name: 'Nuovo nutriente', form: '*', unit: 'mg', target: 0, period: 'day', kind: 'minimum' }]) }, "+ Nutriente")),
                React.createElement("div", { className: "goalTable" }, goals.map((g, i) => React.createElement("div", { className: "goalEdit", key: g.id },
                    React.createElement("input", { value: g.name, onChange: e => { const a = [...goals]; a[i] = { ...g, name: e.target.value }; setGoals(a); } }),
                    React.createElement("input", { placeholder: "forma: * = tutte", value: g.form || '*', onChange: e => { const a = [...goals]; a[i] = { ...g, form: e.target.value }; setGoals(a); } }),
                    React.createElement("input", { type: "number", step: "any", value: g.target, onChange: e => { const a = [...goals]; a[i] = { ...g, target: Number(e.target.value) }; setGoals(a); } }),
                    React.createElement("select", { value: g.unit, onChange: e => { const a = [...goals]; a[i] = { ...g, unit: e.target.value }; setGoals(a); } },
                        React.createElement("option", null, "kcal"),
                        React.createElement("option", null, "g"),
                        React.createElement("option", null, "mg"),
                        React.createElement("option", null, "\u00B5g")),
                    React.createElement("select", { value: g.kind, onChange: e => { const a = [...goals]; a[i] = { ...g, kind: e.target.value }; setGoals(a); } },
                        React.createElement("option", { value: "minimum" }, "Minimo"),
                        React.createElement("option", { value: "target" }, "Target"),
                        React.createElement("option", { value: "upper" }, "Massimo")),
                    React.createElement("select", { value: g.period, onChange: e => { const a = [...goals]; a[i] = { ...g, period: e.target.value }; setGoals(a); } },
                        React.createElement("option", { value: "day" }, "Giorno"),
                        React.createElement("option", { value: "week" }, "Settimana")),
                    React.createElement("div", { className: "goalNow" },
                        fmt(valueForGoal(g, g.period === 'week' ? weekTotals : totals), 2),
                        " ",
                        g.unit),
                    React.createElement("button", { className: "ghost danger", onClick: () => setGoals(goals.filter(x => x.id !== g.id)) }, "\u00D7")))))),
        tab === 'dati' && React.createElement("section", null,
            React.createElement("div", { className: "twoCol" },
                React.createElement("article", { className: "card" },
                    React.createElement("h2", null, "Database sul dispositivo"),
                    React.createElement("div", { className: "sourceList" },
                        SCIENTIFIC_SOURCES.map(source => React.createElement("div", { key: source },
                            React.createElement("b", null, SOURCE_META[source].name),
                            React.createElement("span", null, datasetStatus[source] ? `${datasetStatus[source]} alimenti · offline` : 'non installato'))),
                        React.createElement("div", null,
                            React.createElement("b", null, "USDA prodotti commerciali"),
                            React.createElement("span", null, commercialOnline ? 'online opzionale attivo' : 'disattivato')),
                        React.createElement("div", null,
                            React.createElement("b", null, "Etichetta produttore"),
                            React.createElement("span", null, "priorit\u00E0 massima sul prodotto specifico")))),
                React.createElement("article", { className: "card" },
                    React.createElement("h2", null, "Backup"),
                    React.createElement("button", { className: "cta", onClick: exportData }, "Esporta JSON"),
                    React.createElement("label", { className: "importLabel" },
                        "Importa backup",
                        React.createElement("input", { type: "file", accept: "application/json", onChange: importBackup })),
                    React.createElement("p", { className: "muted tiny" }, "I database scientifici grandi restano in IndexedDB e non vengono duplicati nel backup del diario."))),
            React.createElement("article", { className: "card" },
                React.createElement("h2", null, "Installa / aggiorna database scientifici"),
                React.createElement("p", { className: "muted" }, "Questi file vengono letti una volta e indicizzati sul dispositivo. Dopo l\u2019importazione la ricerca funziona offline. Per USDA puoi selezionare direttamente il download JSON/ZIP ufficiale di Foundation Foods o SR Legacy; per CIQUAL, FRIDA e CoFID usa il loro file tabellare ufficiale."),
                React.createElement("div", { className: "datasetGrid" }, SCIENTIFIC_SOURCES.map(source => React.createElement("div", { className: "datasetCard", key: source },
                    React.createElement("b", null, SOURCE_META[source].name),
                    React.createElement("small", null, SOURCE_META[source].version),
                    React.createElement("input", { type: "file", accept: source.startsWith('USDA_') ? '.zip,.json' : '.xlsx,.xls,.csv,.ods', onChange: e => e.target.files?.[0] && importDataset(source, e.target.files[0]) }),
                    datasetStatus[source] > 0 && React.createElement("button", { className: "ghost danger", onClick: () => removeDataset(source) }, "Rimuovi dataset")))),
                datasetMsg && React.createElement("p", { className: "statusMsg" }, datasetMsg)),
            React.createElement("article", { className: "card notice" },
                React.createElement("h3", null, "Privacy e funzionamento offline"),
                React.createElement("p", null, "Diario, profilo, alimenti personali e database scientifici sono memorizzati localmente. La rete viene usata solo se attivi volontariamente la ricerca dei prodotti commerciali online o quando scarichi un aggiornamento dei dataset.")),
            React.createElement("article", { className: "card notice" },
                React.createElement("h3", null, "Come leggere la biodisponibilit\u00E0"),
                React.createElement("p", null, "La quota \u201Cassorbibile stimata\u201D compare solo quando nella scheda del nutriente \u00E8 presente un intervallo di assorbimento con una fonte. Per ferro, magnesio e altri nutrienti l\u2019assorbimento dipende anche da dieta, dose, matrice alimentare e fisiologia: il valore \u00E8 quindi una stima, non una misura individuale."))),
        foodDraft && React.createElement("div", { className: "modalBackdrop" },
            React.createElement("div", { className: "modal" },
                React.createElement("div", { className: "modalHead" },
                    React.createElement("div", null,
                        React.createElement("span", { className: "eyebrow" }, "SCHEDA ALIMENTO"),
                        React.createElement("h2", null, foodDraft.name || 'Nuovo alimento')),
                    React.createElement("button", { className: "close", onClick: () => setFoodDraft(null) }, "\u00D7")),
                foodDraft.mergeMeta?.mode === 'review' && React.createElement("div", { className: "mergeWarning" },
                    React.createElement("b", null, "Possibile corrispondenza con un alimento gi\u00E0 presente."),
                    " Controlla i dati importati: l\u2019etichetta manuale non viene sostituita automaticamente."),
                React.createElement("div", { className: "formGrid" },
                    React.createElement("label", null,
                        "Nome rapido",
                        React.createElement("input", { value: foodDraft.name, onChange: e => setFoodDraft({ ...foodDraft, name: e.target.value }) }),
                        React.createElement("small", null, "\u00C8 il nome che userai ogni giorno.")),
                    React.createElement("label", null,
                        "Marca (opzionale)",
                        React.createElement("input", { value: foodDraft.brand, onChange: e => setFoodDraft({ ...foodDraft, brand: e.target.value }) })),
                    React.createElement("label", null,
                        "Valori riferiti a (g)",
                        React.createElement("input", { type: "number", value: foodDraft.servingGrams, onChange: e => setFoodDraft({ ...foodDraft, servingGrams: e.target.value }) }))),
                foodDraft.officialName && foodDraft.officialName !== foodDraft.name && React.createElement("p", { className: "officialName" },
                    React.createElement("b", null, "Voce ufficiale:"),
                    " ",
                    foodDraft.officialName),
                React.createElement("label", null,
                    "Alias di ricerca (separati da virgola)",
                    React.createElement("input", { value: (foodDraft.aliases || []).join(', '), onChange: e => setFoodDraft({ ...foodDraft, aliases: e.target.value.split(',').map(x => x.trim()).filter(Boolean) }) })),
                React.createElement("h3", null, "Etichetta / macro"),
                React.createElement("div", { className: "formGrid" }, Object.entries(MACROS).map(([k, l]) => React.createElement("label", { key: k },
                    l,
                    React.createElement("input", { type: "number", step: "any", value: foodDraft.label?.[k] ?? '', onChange: e => setFoodDraft({ ...foodDraft, label: { ...foodDraft.label, [k]: e.target.value } }) })))),
                React.createElement("h3", null, "Ingredienti completi"),
                React.createElement("label", null,
                    "Lista come in etichetta",
                    React.createElement("textarea", { rows: "4", value: foodDraft.ingredients || '', onChange: e => setFoodDraft({ ...foodDraft, ingredients: e.target.value }) })),
                parseAdditives(foodDraft.ingredients).length > 0 && React.createElement("div", { className: "chips" }, parseAdditives(foodDraft.ingredients).map(a => React.createElement("span", { key: a }, a))),
                React.createElement("div", { className: "cardTitle" },
                    React.createElement("div", null,
                        React.createElement("h3", null, "Nutrienti specifici / forme"),
                        React.createElement("p", null, "Quantit\u00E0 per la base indicata sopra. \u201CElementare\u201D \u00E8 opzionale per sali/composti.")),
                    React.createElement("button", { className: "ghost", onClick: addNutrient }, "+ Aggiungi")),
                (foodDraft.nutrients || []).map((n, i) => React.createElement("div", { className: "nutrientAdvanced", key: n.id },
                    React.createElement("div", { className: "nutrientMain" },
                        React.createElement("input", { placeholder: "Magnesio / EPA / Leucina", value: n.name, onChange: e => editNutrient(i, { name: e.target.value }) }),
                        React.createElement("input", { placeholder: "forma: citrato, eme, ALA\u2026", value: n.form || '', onChange: e => editNutrient(i, { form: e.target.value }) }),
                        React.createElement("input", { type: "number", step: "any", placeholder: "quantit\u00E0", value: n.amount, onChange: e => editNutrient(i, { amount: e.target.value }) }),
                        React.createElement("select", { value: n.unit, onChange: e => editNutrient(i, { unit: e.target.value }) },
                            React.createElement("option", null, "mg"),
                            React.createElement("option", null, "\u00B5g"),
                            React.createElement("option", null, "g")),
                        React.createElement("button", { className: "ghost danger", onClick: () => setFoodDraft({ ...foodDraft, nutrients: foodDraft.nutrients.filter(x => x.id !== n.id) }) }, "\u00D7")),
                    React.createElement("div", { className: "bioEdit" },
                        React.createElement("label", null,
                            "Quantit\u00E0 elementare (opz.)",
                            React.createElement("input", { type: "number", step: "any", value: n.elementalAmount ?? '', onChange: e => editNutrient(i, { elementalAmount: e.target.value }) })),
                        React.createElement("label", null,
                            "Assorbimento minimo %",
                            React.createElement("input", { type: "number", step: "any", min: "0", max: "100", value: n.bio?.min ?? '', onChange: e => editNutrient(i, { bio: { ...(n.bio || {}), mode: 'range', min: e.target.value } }) })),
                        React.createElement("label", null,
                            "Assorbimento massimo %",
                            React.createElement("input", { type: "number", step: "any", min: "0", max: "100", value: n.bio?.max ?? '', onChange: e => editNutrient(i, { bio: { ...(n.bio || {}), mode: 'range', max: e.target.value } }) })),
                        React.createElement("label", null,
                            "Fonte stima",
                            React.createElement("input", { placeholder: "studio / NIH / nota", value: n.bio?.source ?? '', onChange: e => editNutrient(i, { bio: { ...(n.bio || {}), source: e.target.value } }) })),
                        React.createElement("label", null,
                            "Fonte composizione",
                            React.createElement("input", { placeholder: "USDA / CIQUAL / etichetta", value: n.source || '', onChange: e => editNutrient(i, { source: e.target.value }) }))))),
                React.createElement("div", { className: "cardTitle" },
                    React.createElement("h3", null, "Fonti"),
                    React.createElement("button", { className: "ghost", onClick: () => setFoodDraft({ ...foodDraft, sources: [...(foodDraft.sources || []), { id: crypto.randomUUID(), name: '', reference: '', quality: 'primaria' }] }) }, "+ Fonte")),
                (foodDraft.sources || []).map((s, i) => React.createElement("div", { className: "sourceEdit", key: s?.id || i },
                    React.createElement("input", { value: s?.name || '', placeholder: "Fonte", onChange: e => { const x = [...foodDraft.sources]; x[i] = { ...s, name: e.target.value }; setFoodDraft({ ...foodDraft, sources: x }); } }),
                    React.createElement("input", { value: s?.reference || '', placeholder: "Riferimento", onChange: e => { const x = [...foodDraft.sources]; x[i] = { ...s, reference: e.target.value }; setFoodDraft({ ...foodDraft, sources: x }); } }),
                    React.createElement("select", { value: s?.quality || 'primaria', onChange: e => { const x = [...foodDraft.sources]; x[i] = { ...s, quality: e.target.value }; setFoodDraft({ ...foodDraft, sources: x }); } },
                        React.createElement("option", { value: "primaria" }, "Primaria"),
                        React.createElement("option", { value: "secondaria" }, "Secondaria"),
                        React.createElement("option", { value: "stimata" }, "Stimata")),
                    React.createElement("button", { className: "ghost danger", onClick: () => setFoodDraft({ ...foodDraft, sources: foodDraft.sources.filter((_, j) => j !== i) }) }, "\u00D7"))),
                React.createElement("label", null,
                    "Note",
                    React.createElement("textarea", { rows: "3", value: foodDraft.notes || '', onChange: e => setFoodDraft({ ...foodDraft, notes: e.target.value }) })),
                React.createElement("div", { className: "modalActions" },
                    React.createElement("button", { className: "ghost", onClick: () => setFoodDraft(null) }, "Annulla"),
                    React.createElement("button", { className: "cta", onClick: saveFood }, "Salva alimento")))));
}
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(React.createElement(Home, null));
