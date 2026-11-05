export type Category = 'människa' | 'djur' | 'fordon' | 'föremål';

export const CATEGORY_COLOR: Record<Category, string> = {
  människa: '#00e5ff',
  djur: '#b6ff3d',
  fordon: '#ff9f1c',
  föremål: '#ff3df2',
};

export const CATEGORY_PLURAL: Record<Category, [string, string]> = {
  människa: ['människa', 'människor'],
  djur: ['djur', 'djur'],
  fordon: ['fordon', 'fordon'],
  föremål: ['föremål', 'föremål'],
};

const ANIMALS = 'bird cat dog horse sheep cow elephant bear zebra giraffe'.split(' ');
const VEHICLES = ['bicycle', 'car', 'motorcycle', 'airplane', 'bus', 'train', 'truck', 'boat'];

const SV: Record<string, string> = {
  person: 'Människa', bicycle: 'Cykel', car: 'Bil', motorcycle: 'Motorcykel', airplane: 'Flygplan', bus: 'Buss',
  train: 'Tåg', truck: 'Lastbil', boat: 'Båt', 'traffic light': 'Trafikljus', 'fire hydrant': 'Brandpost',
  'stop sign': 'Stoppskylt', 'parking meter': 'Parkeringsautomat', bench: 'Bänk', bird: 'Fågel', cat: 'Katt',
  dog: 'Hund', horse: 'Häst', sheep: 'Får', cow: 'Ko', elephant: 'Elefant', bear: 'Björn', zebra: 'Zebra',
  giraffe: 'Giraff', backpack: 'Ryggsäck', umbrella: 'Paraply', handbag: 'Handväska', tie: 'Slips',
  suitcase: 'Resväska', frisbee: 'Frisbee', skis: 'Skidor', snowboard: 'Snowboard', 'sports ball': 'Boll',
  kite: 'Drake', 'baseball bat': 'Basebollträ', 'baseball glove': 'Basebollhandske', skateboard: 'Skateboard',
  surfboard: 'Surfbräda', 'tennis racket': 'Tennisracket', bottle: 'Flaska', 'wine glass': 'Vinglas', cup: 'Kopp',
  fork: 'Gaffel', knife: 'Kniv', spoon: 'Sked', bowl: 'Skål', banana: 'Banan', apple: 'Äpple', sandwich: 'Smörgås',
  orange: 'Apelsin', broccoli: 'Broccoli', carrot: 'Morot', 'hot dog': 'Varmkorv', pizza: 'Pizza', donut: 'Munk',
  cake: 'Tårta', chair: 'Stol', couch: 'Soffa', 'potted plant': 'Krukväxt', bed: 'Säng', 'dining table': 'Bord',
  toilet: 'Toalett', tv: 'TV', laptop: 'Laptop', mouse: 'Datormus', remote: 'Fjärrkontroll', keyboard: 'Tangentbord',
  'cell phone': 'Mobiltelefon', microwave: 'Mikrovågsugn', oven: 'Ugn', toaster: 'Brödrost', sink: 'Diskho',
  refrigerator: 'Kylskåp', book: 'Bok', clock: 'Klocka', vase: 'Vas', scissors: 'Sax', 'teddy bear': 'Nallebjörn',
  'hair drier': 'Hårtork', toothbrush: 'Tandborste',
};

export function describe(label: string): { name: string; cat: Category } {
  const cat: Category = label === 'person' ? 'människa' : ANIMALS.includes(label) ? 'djur' : VEHICLES.includes(label) ? 'fordon' : 'föremål';
  return { name: SV[label] ?? label, cat };
}
