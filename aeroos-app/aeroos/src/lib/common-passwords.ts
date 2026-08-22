/**
 * Sous-ensemble des mots de passe les plus fréquemment compromis
 * (classements type RockYou / Have I Been Pwned). Comparaison
 * insensible à la casse dans isCommonPassword().
 */
const BASE_WORDS = [
  'password', 'letmein', 'welcome', 'monkey', 'dragon', 'master', 'shadow',
  'football', 'baseball', 'basketball', 'soccer', 'hockey', 'superman',
  'batman', 'starwars', 'trustno1', 'iloveyou', 'sunshine', 'princess',
  'flower', 'hello', 'freedom', 'whatever', 'nothing', 'summer', 'winter',
  'autumn', 'spring', 'ninja', 'pirate', 'cheese', 'chocolate', 'butterfly',
  'dolphin', 'tigger', 'jordan', 'michael', 'jennifer', 'jessica', 'ashley',
  'amanda', 'daniel', 'joshua', 'matthew', 'andrew', 'george', 'charlie',
  'thomas', 'robert', 'william', 'richard', 'anthony', 'donald', 'steven',
  'admin', 'administrator', 'root', 'guest', 'test', 'demo', 'sample',
  'default', 'changeme', 'temp', 'temporary', 'secret', 'access', 'login',
  'system', 'server', 'network', 'internet', 'computer', 'office', 'company',
  'business', 'money', 'dollars', 'ferrari', 'porsche', 'mustang', 'corvette',
  'harley', 'diamond', 'silver', 'golden', 'bronze', 'crystal', 'phoenix',
  'dragonfly', 'eagle', 'falcon', 'hawk', 'panther', 'cobra', 'viper',
  'scorpion', 'spider', 'wolf', 'bear', 'lion', 'tiger', 'shark', 'whale',
  'elephant', 'giraffe', 'zebra', 'monkey1', 'purple', 'orange', 'yellow',
  'rainbow', 'thunder', 'lightning', 'hurricane', 'tornado', 'volcano',
  'mountain', 'ocean', 'river', 'forest', 'desert', 'island', 'castle',
  'knight', 'wizard', 'dragon1', 'phoenix1', 'angel', 'devil', 'heaven',
  'hell', 'love', 'hate', 'happy', 'sad', 'crazy', 'wild', 'free', 'brave',
  'strong', 'smart', 'cool', 'awesome', 'amazing', 'perfect', 'beautiful',
];

const SUFFIXES = ['', '1', '12', '123', '1234', '12345', '123456', '01', '2020', '2021', '2022', '2023', '2024', '!', '01!'];

const LITERAL_COMMON = [
  '123456', '123456789', '12345678', '12345', '1234567', '1234567890',
  'qwerty', 'qwerty123', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm', '1q2w3e4r',
  '1qaz2wsx', 'password1', 'password123', 'passw0rd', 'p@ssw0rd', 'letmein1',
  'abc123', 'abcd1234', 'a1b2c3', '000000', '111111', '222222', '654321',
  '987654321', 'iloveyou1', 'admin123', 'root123', 'welcome1', 'welcome123',
  'monkey123', 'football1', 'baseball1', 'dragon123', 'trustno1!', 'sunshine1',
  'princess1', 'letmein123', 'login123', 'master123', 'shadow123', 'mynoob',
  'access123', 'flower1', 'hottie', 'loveme', 'jesus1', 'ninja123', 'mustang1',
  'starwars1', 'superman1', 'batman123', 'zaq1zaq1', 'qazwsx', 'trustno1',
  'aeroos', 'aeroos123', 'aviation', 'aviation1', 'lessor123', 'meridian',
  'meridian123', 'demo1234', 'changeme123', 'temporary1', 'passwordpassword',
];

function generateCommonPasswords(): Set<string> {
  const set = new Set<string>();
  for (const literal of LITERAL_COMMON) set.add(literal.toLowerCase());
  for (const word of BASE_WORDS) {
    for (const suffix of SUFFIXES) {
      set.add((word + suffix).toLowerCase());
    }
  }
  return set;
}

const COMMON_PASSWORDS = generateCommonPasswords();

export function isCommonPassword(pwd: string): boolean {
  return COMMON_PASSWORDS.has(pwd.toLowerCase());
}
