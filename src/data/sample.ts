// Sample data for testing (Dan, 2026-11-04): both parts filled with a made-up house, so every
// screen has something to show. Offered at first setup and in More › Backup & restore while the
// app is being built; remove before 1.0, when a new phone starts with no items again.
import { ID_PREFIX, newId } from '../domain/ids';
import { defaultAreaCode, LOOSE_SPOT } from '../domain/places';
import { blankItem, nameKey, type Area, type Bin, type Category, type Condition, type Item, type Part, type Season, type Spot, type Tag } from '../domain/types';
import type { ReplaceAllInput } from './inventory';
import { emptyStart } from './setup';

/** A spot: its name, the things loose on it, and its bins. */
interface SpotPlan {
  name: string;
  items?: ItemPlan[];
  bins?: BinPlan[];
}
interface BinPlan {
  name: string;
  season?: string;
  state?: 'out';
  tags?: string[];
  items: ItemPlan[];
}
/** [name, category, quantity, extras] */
type ItemPlan = [string, string, number, ItemExtras?];
type ItemExtras = Partial<Pick<Item, 'subcategory' | 'approx' | 'conditionNote' | 'notes' | 'model' | 'barcode' | 'lentTo' | 'lentOn' | 'outWhere'>> & {
  tags?: string[];
  value?: number;
  display?: string;
  season?: string;
  status?: 'out' | 'lent';
  condition?: Condition;
};
interface AreaPlan {
  name: string;
  spots: SpotPlan[];
}

const HOUSEHOLD: AreaPlan[] = [
  {
    name: 'Garage',
    spots: [
      {
        name: 'Pegboard',
        items: [
          ['Claw hammer', 'Tools', 1, { subcategory: 'Hand tools' }],
          ['Tape measure 25 ft', 'Tools', 2, { subcategory: 'Hand tools' }],
          ['Hacksaw', 'Tools', 1, { subcategory: 'Hand tools', condition: 'needs repair', conditionNote: 'Blade dull' }],
        ],
      },
      {
        name: 'Workbench',
        items: [['Cordless drill', 'Tools', 1, { subcategory: 'Power tools', model: 'DeWalt DCD771', value: 9900, tags: ['Charger needed'] }]],
        bins: [
          { name: 'Screws & nails', items: [['Wood screws #8', 'Hardware', 200, { approx: true }], ['Finish nails', 'Hardware', 150, { approx: true }], ['Drywall anchors', 'Hardware', 40, { approx: true }]] },
          { name: 'Electrical', items: [['Extension cord 25 ft', 'Electronics', 2], ['Wire nuts', 'Hardware', 30, { approx: true }], ['Outlet tester', 'Tools', 1]] },
        ],
      },
      {
        name: 'Shelf A',
        bins: [
          { name: 'Car care', items: [['Car wax', 'Cleaning & laundry', 1], ['Microfiber towels', 'Cleaning & laundry', 12], ['Tire gauge', 'Tools', 1]] },
          { name: 'Camping', tags: ['Heavy'], items: [['Tent (4-person)', 'Sports & outdoors', 1, { value: 18900 }], ['Sleeping bags', 'Sports & outdoors', 4], ['Camp stove', 'Sports & outdoors', 1, { status: 'lent', lentTo: 'Mike (neighbour)', lentOn: '2026-10-20' }]] },
        ],
      },
      { name: 'Floor by door', items: [['Snow shovel', 'Yard & garden', 2], ['Leaf rake', 'Yard & garden', 1], ['Garden hose 50 ft', 'Yard & garden', 1, { condition: 'replace', conditionNote: 'Leaks at the end' }]] },
    ],
  },
  {
    name: 'Kitchen',
    spots: [
      { name: 'Pantry shelves', items: [['Canned tomatoes', 'Pantry', 6], ['Pasta', 'Pantry', 4], ['Rice (bag)', 'Pantry', 1], ['Peanut butter', 'Pantry', 2, { barcode: '0051500255162' }]] },
      { name: 'Under sink', items: [['Dish soap', 'Cleaning & laundry', 2], ['Dishwasher pods', 'Cleaning & laundry', 60, { approx: true }], ['Rubber gloves', 'Cleaning & laundry', 3]] },
      { name: 'Top cabinet', items: [['Stand mixer', 'Kitchen', 1, { model: 'KitchenAid K45', value: 32900 }], ['Slow cooker', 'Kitchen', 1, { status: 'lent', lentTo: 'Sarah', lentOn: '2026-10-28' }]] },
    ],
  },
  {
    name: 'Guest closet',
    spots: [
      { name: LOOSE_SPOT, items: [['Vacuum cleaner', 'Cleaning & laundry', 1, { model: 'Shark NV352' }], ['Folding chairs', 'Other', 4], ['Ironing board', 'Cleaning & laundry', 1]] },
      {
        name: 'Top shelf',
        bins: [
          { name: 'Winter wear', items: [['Winter hats', 'Seasonal clothing', 6], ['Mittens (pairs)', 'Seasonal clothing', 8], ['Scarves', 'Seasonal clothing', 5]] },
          { name: 'Spare bedding', items: [['Queen sheet set', 'Other', 2], ['Pillows', 'Other', 4], ['Wool blanket', 'Other', 1]] },
        ],
      },
      { name: 'Floor', items: [['Rain boots', 'Seasonal clothing', 3], ['Umbrellas', 'Other', 4]] },
    ],
  },
  {
    name: 'Basement',
    spots: [
      {
        name: 'Storage shelf',
        bins: [
          { name: 'Important papers', tags: ['Fragile'], items: [['Tax returns 2020–2025', 'Documents & keepsakes', 6], ['House documents', 'Documents & keepsakes', 1], ['Warranty folder', 'Documents & keepsakes', 1]] },
          { name: 'Old electronics', items: [['HDMI cables', 'Electronics', 7], ['Old laptop', 'Electronics', 1, { condition: 'toss' }], ['Phone chargers', 'Electronics', 9, { approx: true }]] },
        ],
      },
      { name: 'Laundry corner', items: [['Laundry detergent', 'Cleaning & laundry', 2], ['Stain remover', 'Cleaning & laundry', 1]] },
    ],
  },
];

const HOLIDAY: AreaPlan[] = [
  {
    name: 'Storage room',
    spots: [
      {
        name: 'Shelf A',
        bins: [
          {
            name: 'Christmas ornaments 1',
            season: 'Christmas',
            tags: ['Fragile'],
            items: [
              ['Glass ball ornaments', 'Ornaments', 48, { approx: true, display: 'Living room tree' }],
              ['Grandma’s angel topper', 'Ornaments', 1, { display: 'Living room tree', tags: ['Fragile'], value: 0, notes: 'Wrap in tissue' }],
              ['Kids’ handmade ornaments', 'Ornaments', 20, { approx: true, display: 'Living room tree' }],
            ],
          },
          {
            name: 'Christmas ornaments 2',
            season: 'Christmas',
            tags: ['Fragile'],
            items: [['Wooden ornaments', 'Ornaments', 24, { display: 'Living room tree' }], ['Tree skirt', 'Tableware & linens', 1, { display: 'Living room tree' }]],
          },
          {
            name: 'Christmas lights',
            season: 'Christmas',
            items: [
              ['Warm white mini lights', 'Lights', 8, { display: 'Living room tree' }],
              ['C9 outdoor lights', 'Lights', 4, { display: 'Front porch' }],
              ['Light timer', 'Lights', 2, { condition: 'needs repair', conditionNote: 'One timer sticks' }],
            ],
          },
        ],
      },
      {
        name: 'Shelf B',
        bins: [
          { name: 'Mantel & table', season: 'Christmas', items: [['Stockings', 'Tableware & linens', 5, { display: 'Mantel' }], ['Garland 9 ft', 'Wreaths & garland', 2, { display: 'Mantel' }], ['Christmas tablecloth', 'Tableware & linens', 1, { display: 'Dining table' }], ['Candle holders', 'Tableware & linens', 4, { display: 'Dining table' }]] },
          { name: 'Christmas village', season: 'Christmas', tags: ['Fragile'], items: [['Village houses', 'Village & figurines', 12, { display: 'Mantel' }], ['Village people & trees', 'Village & figurines', 30, { approx: true, display: 'Mantel' }]] },
          { name: 'Wrapping', season: 'Christmas', items: [['Wrapping paper rolls', 'Wrapping & cards', 10], ['Gift bags', 'Wrapping & cards', 25, { approx: true }], ['Tape & ribbon', 'Wrapping & cards', 1]] },
        ],
      },
      {
        name: 'Shelf C',
        bins: [
          {
            name: 'Halloween decor',
            season: 'Halloween',
            state: 'out',
            items: [
              ['Skeleton (life-size)', 'Inflatables & yard', 1, { display: 'Front porch', status: 'out', outWhere: 'Front porch' }],
              ['Jack-o’-lantern lights', 'Lights', 2, { display: 'Front porch', status: 'out', outWhere: 'Front porch' }],
              ['Spider webbing', 'Other', 3, { display: 'Front porch' }],
            ],
          },
          { name: 'Costumes', season: 'Halloween', items: [['Witch hat', 'Costumes', 1], ['Pirate costume', 'Costumes', 1], ['Face paint kit', 'Costumes', 1]] },
          { name: 'Easter', season: 'Easter', items: [['Plastic eggs', 'Other', 60, { approx: true }], ['Easter baskets', 'Other', 4], ['Bunny figurine', 'Village & figurines', 1, { display: 'Dining table' }]] },
        ],
      },
    ],
  },
  {
    name: 'Attic',
    spots: [
      { name: LOOSE_SPOT, items: [['Artificial tree 7.5 ft', 'Trees', 1, { season: 'Christmas', display: 'Living room tree', value: 29900 }], ['Tree stand', 'Trees', 1, { season: 'Christmas', display: 'Living room tree' }]] },
      {
        name: 'Near hatch',
        bins: [
          { name: 'Outdoor Christmas', season: 'Christmas', tags: ['Heavy'], items: [['Inflatable snowman', 'Inflatables & yard', 1, { display: 'Front yard' }], ['Pathway stakes', 'Lights', 12, { display: 'Front yard' }], ['Front door wreath', 'Wreaths & garland', 1, { display: 'Front porch' }]] },
          { name: 'Fall & Thanksgiving', season: 'Thanksgiving', items: [['Fall leaf garland', 'Wreaths & garland', 3, { season: 'Fall', display: 'Mantel' }], ['Turkey centerpiece', 'Tableware & linens', 1, { display: 'Dining table' }], ['Harvest table runner', 'Tableware & linens', 1, { display: 'Dining table' }]] },
        ],
      },
    ],
  },
  {
    name: 'Shed',
    spots: [{ name: 'Back wall', items: [['Light-up reindeer', 'Inflatables & yard', 2, { season: 'Christmas', display: 'Front yard', condition: 'needs repair', conditionNote: 'One antler loose' }], ['Extension cords (outdoor)', 'Lights', 3, { season: 'Christmas' }]] }],
  },
];

const DISPLAYS = ['Front porch', 'Front yard', 'Living room tree', 'Mantel', 'Dining table'];

const TASKS: Record<string, { setup: string[]; takedown: string[] }> = {
  Christmas: {
    setup: ['Test all light strings before hanging', 'Buy a new tree-stand water bowl', 'Put up outdoor lights (dry day)', 'Set the light timers to 5 pm'],
    takedown: ['Check lights and note the broken strings', 'Wrap ornaments in tissue', 'Water the outdoor plugs dry before storing'],
  },
  Halloween: { setup: ['Carve pumpkins', 'Buy candy'], takedown: ['Throw out pumpkins'] },
};

const HOUSEHOLD_TAGS = ['Fragile', 'Heavy', 'Charger needed'];
const HOLIDAY_TAGS = ['Fragile', 'Heavy'];

/** Both parts with a made-up house: areas, spots, bins, items, displays, season tasks and one season out (Halloween). */
export function sampleStart(random: () => number = Math.random, now = Date.now()): ReplaceAllInput {
  const base = emptyStart(random);
  const taken = new Set<string>(base.seasons.map((s) => s.id));
  const id = (prefix: string) => {
    const x = newId(prefix, (v) => taken.has(v), random);
    taken.add(x);
    return x;
  };
  const season = (name: string): Season => base.seasons.find((s) => nameKey(s.name) === nameKey(name)) ?? fail(`no season ${name}`);
  const displays = DISPLAYS.map((name, order) => ({ id: id(ID_PREFIX.display), name, order, notes: '' }));
  const display = (name: string) => displays.find((d) => d.name === name)?.id ?? fail(`no display ${name}`);

  const areas: Area[] = [];
  const spots: Spot[] = [];
  const bins: Bin[] = [];
  const items: Item[] = [];
  const subcats = new Map<string, Set<string>>();

  const addItem = (part: Part, [name, category, quantity, x = {}]: ItemPlan, home: { binId: string } | { spotId: string }) => {
    const { tags = [], value, display: dp, season: se, status, ...rest } = x;
    const item: Item = { ...blankItem(id(ID_PREFIX.item), name, category, part), ...rest, ...home, quantity, tags, value: value ?? null };
    if (part === 'holiday') {
      if (dp) item.displayId = display(dp);
      if (se) item.seasonId = season(se).id;
    }
    if (status === 'out') {
      item.status = 'out';
      item.outSince = now - 5 * 86_400_000;
      if (part === 'holiday' && dp) item.outDisplayId = display(dp);
    } else if (status === 'lent') item.status = 'lent';
    if (item.subcategory) {
      const key = `${part}\n${category}`;
      subcats.set(key, (subcats.get(key) ?? new Set()).add(item.subcategory));
    }
    items.push(item);
  };

  for (const [part, plan] of [['household', HOUSEHOLD], ['holiday', HOLIDAY]] as const) {
    for (const a of plan) {
      const code = defaultAreaCode(a.name, areas.map((x) => x.code)) ?? fail(`no code for ${a.name}`);
      const area: Area = { id: id(ID_PREFIX.area), part, name: a.name, code, order: areas.filter((x) => x.part === part).length, notes: '' };
      areas.push(area);
      let n = 0;
      a.spots.forEach((s, order) => {
        const spot: Spot = { id: id(ID_PREFIX.spot), areaId: area.id, name: s.name, order, notes: '' };
        spots.push(spot);
        for (const it of s.items ?? []) addItem(part, it, { spotId: spot.id });
        for (const b of s.bins ?? []) {
          const bin: Bin = {
            id: id(ID_PREFIX.bin),
            code: `${code}-${String(++n).padStart(2, '0')}`,
            name: b.name,
            part,
            spotId: spot.id,
            seasonId: part === 'holiday' && b.season ? season(b.season).id : '',
            tags: b.tags ?? [],
            state: b.state ?? 'stored',
            notes: '',
            labelPrintedAt: null,
            labelContents: null,
          };
          bins.push(bin);
          for (const it of b.items) addItem(part, it, { binId: bin.id });
        }
      });
    }
  }

  const categories: Category[] = base.categories.map((c) => ({ ...c, subcategories: [...(subcats.get(`${c.part}\n${c.name}`) ?? [])] }));
  const tags: Tag[] = [...HOUSEHOLD_TAGS.map((name, order) => ({ part: 'household' as const, name, order })), ...HOLIDAY_TAGS.map((name, order) => ({ part: 'holiday' as const, name, order }))];
  const seasonTasks = Object.entries(TASKS).flatMap(([name, t]) =>
    (['setup', 'takedown'] as const).flatMap((phase) => t[phase].map((text, order) => ({ id: id(ID_PREFIX.task), seasonId: season(name).id, phase, text, order }))),
  );
  // Halloween is up (its decor is out), so Put back has something to do.
  const halloween = season('Halloween');
  const year = new Date(now).getFullYear();
  const seasonRuns = [
    { id: id(ID_PREFIX.run), seasonId: halloween.id, year, setupFrom: '', takedownBy: '', phase: 'up' as const, doneTaskIds: seasonTasks.filter((t) => t.seasonId === halloween.id && t.phase === 'setup').map((t) => t.id), startedAt: now - 7 * 86_400_000, finishedAt: null },
  ];
  return { ...base, areas, spots, bins, items, categories, tags, displays, seasonTasks, seasonRuns };
}

function fail(message: string): never {
  throw new Error(message);
}
