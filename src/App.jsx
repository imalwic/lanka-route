import { useState, useEffect, useRef } from 'react';
import L from 'leaflet';
import Chatbot from './components/Chatbot';
import { 
  MapPin, 
  Navigation, 
  Search, 
  Lock, 
  Unlock, 
  Trash2, 
  ChevronUp, 
  ChevronDown, 
  Sparkles, 
  RotateCcw, 
  Compass, 
  HelpCircle, 
  Activity,
  CheckCircle2,
  Locate,
  Flag,
  Sun,
  Moon,
  Menu,
  X,
  Volume2,
  VolumeX,
  Camera,
  Loader,
  ChevronLeft,
  Home
} from 'lucide-react';


import { 
  getOSRMMatrices, 
  optimizeRouteWithLocks, 
  getOSRMRouteGeometry 
} from './utils/optimizer';
import { getEnrichedSinhalaSections } from './utils/wikiEnrichment';

// Travel vehicle modes profiles for speed scaling and expressway constraints in Sri Lanka
const VEHICLE_PROFILES = {
  car: {
    label: 'Car',
    icon: '🚗',
    speedFactor: 1.0,
    allowsExpressway: true,
    speedLimitLabel: 'Max 100 km/h (Expressway)'
  },
  van: {
    label: 'Van',
    icon: '🚐',
    speedFactor: 1.05,
    allowsExpressway: true,
    speedLimitLabel: 'Max 100 km/h (Expressway)'
  },
  bus: {
    label: 'Bus',
    icon: '🚌',
    speedFactor: 1.18, // Adjusted to ~85 km/h average (takes only 18% longer than a standard car)
    allowsExpressway: true,
    speedLimitLabel: 'Max 85 km/h (Expressway/Highway)'
  },
  bike: {
    label: 'Motorbike',
    icon: '🏍️',
    speedFactor: 0.95,
    allowsExpressway: false,
    speedLimitLabel: 'Max 60 km/h (Expressway Banned)'
  },
  threeWheel: {
    label: 'Three-Wheel',
    icon: '🛺',
    speedFactor: 1.40,
    allowsExpressway: false,
    speedLimitLabel: 'Max 40 km/h (Expressway Banned)'
  }
};

// Popular hotspots in Sri Lanka with exact coordinates
const SRI_LANKA_HOTSPOTS = [
  { name: 'Colombo', lat: 6.9271, lng: 79.8612, label: 'Colombo' },
  { name: 'Kandy', lat: 7.2906, lng: 80.6337, label: 'Kandy' },
  { name: 'Ella', lat: 6.8722, lng: 81.0458, label: 'Ella' },
  { name: 'Galle Fort', lat: 6.0264, lng: 80.2176, label: 'Galle' },
  { name: 'Sigiriya', lat: 7.9570, lng: 80.7603, label: 'Sigiriya' },
  { name: 'Nuwara Eliya', lat: 6.9497, lng: 80.7891, label: 'N. Eliya' },
  { name: 'Yala', lat: 6.3687, lng: 81.5208, label: 'Yala' },
  { name: 'Mirissa', lat: 5.9482, lng: 80.4573, label: 'Mirissa' }
];

/**
 * Normalizes the itinerary waypoints array to ensure that:
 * 1. The Start Location (index 0) remains locked.
 * 2. The designated End Location (if any) resides locked at the very end of the array.
 * 3. All intermediate stops reside in the middle, ready to be optimized.
 */
const alignStartAndEnd = (wps) => {
  if (wps.length < 2) return [...wps];
  
  // Find designated End waypoint (if any)
  const endWpIdx = wps.findIndex(w => w.isEnd);
  if (endWpIdx === -1) {
    // If no designated end, just enforce first item is locked
    const normalized = wps.map((w, idx) => idx === 0 ? { ...w, isLocked: true } : w);
    return normalized;
  }
  
  const endWp = { ...wps[endWpIdx], isLocked: true };
  const rest = wps.filter((_, idx) => idx !== endWpIdx);
  
  // Start waypoint (index 0) remains locked
  const normalizedRest = rest.map((w, idx) => {
    // Start point at index 0 must be locked, others should retain their state unless previously marked as End
    if (idx === 0) return { ...w, isLocked: true, isEnd: false };
    return { ...w, isEnd: false }; // Ensure no other isEnd remains
  });
  
  return [...normalizedRest, endWp];
};

// Popular historical places in Sri Lanka for quick-select
const POPULAR_HISTORICAL_SITES = [
  { name: 'Thuparamaya Stupa', wikiTitle: 'Thuparamaya' },
  { name: 'Sigiriya Rock Fortress', wikiTitle: 'Sigiriya' },
  { name: 'Ruwanwelisaya', wikiTitle: 'Ruwanwelisaya' },
  { name: 'Temple of the Tooth', wikiTitle: 'Temple of the Tooth' },
  { name: 'Polonnaruwa Vatadage', wikiTitle: 'Polonnaruwa Vatadage' },
  { name: 'Dambulla Cave Temple', wikiTitle: 'Dambulla cave temple' },
  { name: 'Jaya Sri Maha Bodhi', wikiTitle: 'Jaya Sri Maha Bodhi' },
  { name: 'Nine Arch Bridge', wikiTitle: 'Nine Arch Bridge' }
];

// Helper to parse Wikipedia extracts into sections
const parseWikiSections = (text, isSi = false) => {
  if (!text) return [];
  const lines = text.split('\n');
  const sections = [];
  const defaultTitle = isSi ? 'සාරාංශය (Overview)' : 'Overview';
  let currentSection = { title: defaultTitle, content: [] };
  
  lines.forEach(line => {
    const match = line.match(/^==+\s*(.*?)\s*==+/);
    if (match) {
      if (currentSection.content.length > 0 || currentSection.title !== defaultTitle) {
        sections.push({
          title: currentSection.title,
          content: currentSection.content.join('\n').trim()
        });
      }
      currentSection = { title: match[1], content: [] };
    } else {
      currentSection.content.push(line);
    }
  });
  
  if (currentSection.content.length > 0 || currentSection.title !== defaultTitle) {
    sections.push({
      title: currentSection.title,
      content: currentSection.content.join('\n').trim()
    });
  }
  
  return sections.filter(sec => {
    const lower = sec.title.toLowerCase();
    return sec.content && 
           !lower.includes('references') && 
           !lower.includes('see also') && 
           !lower.includes('notes') && 
           !lower.includes('further reading') && 
           !lower.includes('external links') &&
           !lower.includes('ආශ්‍රිත') &&
           !lower.includes('මූලාශ්‍ර') &&
           !lower.includes('බාහිර') &&
           !lower.includes('සටහන්');
  });
};

// Helper to fetch photo URLs from MediaWiki API
const fetchWikiImages = async (title) => {
  try {
    const url = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(title)}&generator=images&gimlimit=25&prop=imageinfo&iiprop=url&format=json&origin=*&redirects=1`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    const pages = data.query?.pages || {};
    const filteredUrls = [];
    const fallbackUrls = [];
    
    Object.values(pages).forEach(page => {
      const info = page.imageinfo?.[0];
      if (info?.url) {
        const fileUrl = info.url;
        const lower = fileUrl.toLowerCase();
        const isPhoto = lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.png');
        const isNotIcon = !lower.includes('icon') && !lower.includes('disambig') && !lower.includes('padlock') && 
                          !lower.includes('edit-clear') && !lower.includes('question_book') &&
                          !lower.includes('map') && !lower.includes('logo') && !lower.includes('flag') &&
                          !lower.includes('signature') && !lower.includes('coa') && !lower.includes('symbol') &&
                          !lower.includes('plan') && !lower.includes('locator') && !lower.includes('stub');
        
        if (isPhoto) {
          fallbackUrls.push(fileUrl);
          if (isNotIcon) {
            filteredUrls.push(fileUrl);
          }
        }
      }
    });
    return filteredUrls.length > 0 ? filteredUrls : fallbackUrls;
  } catch (err) {
    console.error('Error fetching wiki images:', err);
    return [];
  }
};

// Helper to parse builder and era from overview text
const parseHistoricalStats = (text) => {
  if (!text) return { builder: null, era: null, currentStatus: 'General Location' };
  
  const lowerText = text.toLowerCase();
  let currentStatus = 'General Location';
  if (lowerText.includes('ruin') || lowerText.includes('destroyed')) currentStatus = 'Ruins';
  else if (lowerText.includes('unesco') || lowerText.includes('world heritage')) currentStatus = 'UNESCO Heritage Site';
  else if (lowerText.includes('active') || lowerText.includes('worship') || lowerText.includes('pilgrimage') || lowerText.includes('sacred') || lowerText.includes('relic') || lowerText.includes('temple')) currentStatus = 'Active Religious Site';
  else if (lowerText.includes('park') || lowerText.includes('reserve') || lowerText.includes('sanctuary') || lowerText.includes('forest')) currentStatus = 'Nature Reserve';
  else if (lowerText.includes('beach') || lowerText.includes('bay') || lowerText.includes('coast') || lowerText.includes('sea')) currentStatus = 'Coastal Area';
  else if (lowerText.includes('lake') || lowerText.includes('reservoir') || lowerText.includes('tank') || lowerText.includes('wewa')) currentStatus = 'Water Body';
  else if (lowerText.includes('mountain') || lowerText.includes('peak') || lowerText.includes('range') || lowerText.includes('hill')) currentStatus = 'Mountain/Peak';
  else if (lowerText.includes('university') || lowerText.includes('campus') || lowerText.includes('institute') || lowerText.includes('college') || lowerText.includes('school')) currentStatus = 'Educational Institution';
  
  const kingRegexes = [
    /(?:built|constructed|founded|erected|established)\s+(?:by|during the reign of)\s+(?:King\s+)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})/i,
    /(?:King|ruler)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})/
  ];
  
  let builder = null;
  for (const regex of kingRegexes) {
    const match = text.match(regex);
    if (match && match[1]) {
      const name = match[1].trim();
      if (!['The', 'A', 'He', 'She', 'It', 'In', 'This', 'Itinerary', 'Sri', 'Lanka'].includes(name)) {
        builder = name;
        break;
      }
    }
  }

  const eraRegexes = [
    /(\d+(?:st|nd|rd|th)\s+century\s+(?:BC|AD|BCE|CE))/i,
    /(?:in|around|circa|built in|established in|founded in)\s+(\d{3,4}\s*(?:BC|AD)?)/i
  ];

  let era = null;
  for (const regex of eraRegexes) {
    const match = text.match(regex);
    if (match && match[1]) {
      era = match[1].trim();
      break;
    }
  }

  return { builder, era, currentStatus };
};

// Helper to translate parsed English stats to beautiful Sinhala phrases
const translateStatsToSinhala = (stats) => {
  const dict = {
    'Mahasena of Anuradhapura': 'මහාසේන රජතුමා',
    'King Mahasena': 'මහාසේන රජතුමා',
    'Mahasena': 'මහාසේන රජතුමා',
    'Vattagamani Abhaya': 'වළගම්බා රජතුමා',
    'Vattagamani': 'වළගම්බා රජතුමා',
    'King Dhatusena': 'ධාතුසේන රජතුමා',
    'Dhatusena': 'ධාතුසේන රජතුමා',
    'King Devanampiya Tissa': 'දේවානම්පිය තිස්ස රජතුමා',
    'Devanampiya Tissa': 'දේවානම්පිය තිස්ස රජතුමා',
    'King Dutugemunu': 'දුටුගැමුණු රජතුමා',
    'Dutugemunu': 'දුටුගැමුණු රජතුමා',
    'King Kashyapa': 'කාශ්‍යප රජතුමා',
    'Kashyapa': 'කාශ්‍යප රජතුමා',
    'King Parakramabahu I': 'පළමු පරාක්‍රමබාහු රජතුමා',
    'Parakramabahu I': 'පළමු පරාක්‍රමබාහු රජතුමා',
    'Parakramabahu': 'පරාක්‍රමබාහු රජතුමා',
    'King Walagamba': 'වළගම්බා රජතුමා',
    'Walagamba': 'වළගම්බා රජතුමා',
    'King Saddhatissa': 'සද්ධාතිස්ස රජතුමා',
    'Saddhatissa': 'සද්ධාතිස්ස රජතුමා',
    'King Nissanka Malla': 'නිශ්ශංක මල්ල රජතුමා',
    'Nissanka Malla': 'නිශ්ශංක මල්ල රජතුමා',
    'Ancient Sinhalese Rulers': 'පුරාණ සිංහල රජවරු',
    'Ancient Era': 'පුරාණ යුගය',
    'Historical Monument': 'ඓතිහාසික ස්මාරකය',
    'Ruins': 'නටඹුන් තත්ත්වය',
    'UNESCO Heritage Site': 'යුනෙස්කෝ ලෝක උරුමයකි',
    'Active Religious Site': 'සක්‍රීය පූජනීය ස්ථානයකි',
    'century': 'සියවස',
    '1st century BC': 'පූර්ව ක්‍රිස්තු වර්ෂ 1 වන සියවස',
    '2nd century BC': 'පූර්ව ක්‍රිස්තු වර්ෂ 2 වන සියවස',
    '3rd century BC': 'පූර්ව ක්‍රිස්තු වර්ෂ 3 වන සියවස',
    '4th century BC': 'පූර්ව ක්‍රිස්තු වර්ෂ 4 වන සියවස',
    '5th century BC': 'පූර්ව ක්‍රිස්තු වර්ෂ 5 වන සියවස',
    '1st century AD': 'ක්‍රිස්තු වර්ෂ 1 වන සියවස',
    '2nd century AD': 'ක්‍රිස්තු වර්ෂ 2 වන සියවස',
    '3rd century AD': 'ක්‍රිස්තු වර්ෂ 3 වන සියවස',
    '4th century AD': 'ක්‍රිස්තු වර්ෂ 4 වන සියවස',
    '5th century AD': 'ක්‍රිස්තු වර්ෂ 5 වන සියවස',
    '12th century': '12 වන සියවස',
    '5th century': '5 වන සියවස',
    '3rd century': '3 වන සියවස',
    'British Colonial Era': 'බ්‍රිතාන්‍ය යටත් විජිත යුගය',
    'unknown': 'නොදනී'
  };

  let builder = stats.builder;
  let era = stats.era;
  let currentStatus = stats.currentStatus || 'Historical Monument';

  Object.entries(dict).forEach(([key, val]) => {
    if (builder && builder.toLowerCase().includes(key.toLowerCase())) {
      builder = val;
    }
    if (era && era.toLowerCase().includes(key.toLowerCase())) {
      era = val;
    }
    if (currentStatus && currentStatus.toLowerCase() === key.toLowerCase()) {
      currentStatus = val;
    }
  });

  if (era && era === stats.era) {
    if (/^\d{3,4}$/.test(era.trim())) {
      era = `${era.trim()} වර්ෂයේ`;
    } else {
      era = era
        .replace(/(\d+)(?:st|nd|rd|th)\s+century\s+BC/i, 'ක්‍රි.පූ. $1 වන සියවස')
        .replace(/(\d+)(?:st|nd|rd|th)\s+century\s+AD/i, 'ක්‍රි.ව. $1 වන සියවස')
        .replace(/(\d+)(?:st|nd|rd|th)\s+century/i, '$1 වන සියවස');
    }
  }

  if (builder && builder === stats.builder) {
    if (builder.toLowerCase().startsWith('king ')) {
      builder = builder.substring(5) + ' රජතුමා';
    }
  }

  // Final fallback to ensure NO English letters remain if Sinhala is selected
  if (builder && /[a-zA-Z]/.test(builder)) {
    if (stats.currentStatus === 'Educational Institution') {
      builder = 'නිර්මාතෘවරුන් / බලධාරීන්';
    } else {
      builder = 'පුරාණ ශ්‍රී ලාංකීය රජවරු';
    }
  }
  if (era && /[a-zA-Z]/.test(era)) {
    era = 'පුරාණ යුගය';
  }
  if (currentStatus && /[a-zA-Z]/.test(currentStatus)) {
    currentStatus = 'මනරම් ස්ථානයකි';
  }

  return { builder, era, currentStatus };
};

// Helper to generate a detailed paragraph for the current status
const generateStatusDescription = (status, lang) => {
  if (lang === 'si') {
    if (status.includes('යුනෙස්කෝ') || status === 'UNESCO Heritage Site') {
      return 'මෙම ස්ථානය වර්තමානයේ යුනෙස්කෝ ලෝක උරුමයක් ලෙස නම් කර ඇති අතර, ගෝලීය වශයෙන් ඉහළ පුරාවිද්‍යාත්මක වටිනාකමක් සහිත දැඩි ලෙස සංරක්ෂිත කලාපයක් ලෙස පවත්වාගෙන යනු ලබයි.';
    } else if (status.includes('නටඹුන්') || status === 'Ruins') {
      return 'මෙම ඓතිහාසික ස්ථානය වර්තමානය වන විට නටඹුන් තත්ත්වයේ පවතින අතර, පුරාවිද්‍යා දෙපාර්තමේන්තුව විසින් මතු පරපුර උදෙසා සංරක්ෂණය කර ඇත.';
    } else if (status.includes('සක්‍රීය') || status === 'Active Religious Site') {
      return 'මෙම ස්ථානය වර්තමානය වන විටද සක්‍රීය පූජනීය ස්ථානයක් ලෙස පවතින අතර, දිනපතා විශාල බැතිමතුන් පිරිසක් මෙහි වන්දනාමාන කිරීම සඳහා පැමිණෙති.';
    } else if (status === 'Nature Reserve') {
      return 'මෙම ප්‍රදේශය ස්වභාවික සංරක්ෂිත කලාපයක් හෝ වනජීවී අභයභූමියක් ලෙස පවත්වාගෙන යනු ලබන අතර, ඉතා සුන්දර ස්වභාවික පරිසරයකින් යුක්ත වේ.';
    } else if (status === 'Coastal Area') {
      return 'මෙය දෙස් විදෙස් සංචාරකයින්ගේ අතිශය ආකර්ෂණය දිනාගත්, මනරම් වෙරළ තීරයකින් සමන්විත ප්‍රදේශයකි.';
    } else if (status === 'Water Body') {
      return 'මෙම ස්ථානය ප්‍රදේශයේ කෘෂිකාර්මික හා පාරිසරික අවශ්‍යතා සඳහා අතිශය වැදගත් වන ප්‍රධාන ජලාශයක් හෝ ජල මූලාශ්‍රයක් වේ.';
    } else if (status === 'Mountain/Peak') {
      return 'මෙම ප්‍රදේශය කඳුකර භූ විශමතාවයකින් යුත්, ස්වභාව සෞන්දර්යයෙන් අනූන අලංකාර ස්ථානයකි.';
    } else if (status === 'Educational Institution') {
      return 'මෙම ස්ථානය ශ්‍රී ලංකාවේ ප්‍රධාන අධ්‍යාපනික ආයතනයක් හෝ විශ්වවිද්‍යාලයක් ලෙස ක්‍රියාත්මක වන අතර, විශාල සිසුන් පිරිසකට උසස් අධ්‍යාපන පහසුකම් සපයයි.';
    } else {
      return 'මෙම ප්‍රදේශය ශ්‍රී ලංකාවේ වැදගත් ස්ථානයක් ලෙස හඳුනාගෙන ඇති අතර නිරන්තරයෙන් සංචාරකයින්ගේ අවධානයට ලක්වී ඇත.';
    }
  } else {
    if (status.includes('UNESCO') || status === 'UNESCO Heritage Site') {
      return 'This location is currently designated as a UNESCO World Heritage site and is maintained as a highly protected archaeological zone with immense global historical value.';
    } else if (status.includes('Ruin') || status === 'Ruins') {
      return 'This historical site currently exists in a state of ruins and is actively preserved by the archaeological department for future generations.';
    } else if (status.includes('Active') || status === 'Active Religious Site') {
      return 'This location continues to function as an active religious and sacred site today, attracting a large number of devotees and pilgrims daily.';
    } else if (status === 'Nature Reserve') {
      return 'This area serves as a protected nature reserve or wildlife sanctuary, offering pristine natural environments.';
    } else if (status === 'Coastal Area') {
      return 'This is a beautiful coastal area featuring pristine beaches that attract visitors from around the world.';
    } else if (status === 'Water Body') {
      return 'This location is a significant water body or reservoir, vital for the local environment and agriculture.';
    } else if (status === 'Mountain/Peak') {
      return 'This area is characterized by majestic mountainous terrain and peaks, offering breathtaking scenic beauty.';
    } else if (status === 'Educational Institution') {
      return 'This location serves as a major educational institution or university in Sri Lanka, providing higher education facilities to a large number of students.';
    } else {
      return 'This site currently stands as an important landmark in Sri Lanka and remains a major attraction for visitors.';
    }
  }
};

// Helper to generate unique IDs
const generateId = (prefix = '') => {
  return prefix + Date.now().toString() + Math.random().toString(36).substr(2, 5);
};

export default function App() {
  // State
  // State with LocalStorage Persistence
  const [waypoints, setWaypoints] = useState(() => {
    try {
      const saved = localStorage.getItem('lankaroute_waypoints');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [optimizedWaypoints, setOptimizedWaypoints] = useState([]);
  const [routeOptions, setRouteOptions] = useState([]);
  const [selectedRouteIndex, setSelectedRouteIndex] = useState(0);
  const [selectedVehicle, setSelectedVehicle] = useState(() => {
    return localStorage.getItem('lankaroute_selected_vehicle') || 'car';
  });
  const [pois, setPois] = useState([]);
  const [mapTheme, setMapTheme] = useState(() => {
    return localStorage.getItem('lankaroute_map_theme') || 'dark';
  });
  const [isAutoOptimize, setIsAutoOptimize] = useState(() => {
    const saved = localStorage.getItem('lankaroute_is_auto_optimize');
    return saved !== null ? saved === 'true' : true;
  });
  
  // AI Feature States
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [speechPaused, setSpeechPaused] = useState(false);
  
      
  // Trip budget estimation states (LKR)
  const [ratePerKm, setRatePerKm] = useState(() => {
    const saved = localStorage.getItem('lankaroute_rate_per_km');
    return saved !== null ? Number(saved) : 120;
  });
  const [accommodationCost, setAccommodationCost] = useState(() => {
    const saved = localStorage.getItem('lankaroute_accommodation_cost');
    return saved !== null ? Number(saved) : 0;
  });
  const [foodCost, setFoodCost] = useState(() => {
    const saved = localStorage.getItem('lankaroute_food_cost');
    return saved !== null ? Number(saved) : 0;
  });
  const [otherCost, setOtherCost] = useState(() => {
    const saved = localStorage.getItem('lankaroute_other_cost');
    return saved !== null ? Number(saved) : 0;
  });
  const [numTravelers, setNumTravelers] = useState(() => {
    const saved = localStorage.getItem('lankaroute_num_travelers');
    return saved !== null ? Number(saved) : 1;
  });
  
  const [searchQuery, setSearchQuery] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [isRoundTrip, setIsRoundTrip] = useState(() => {
    const saved = localStorage.getItem('lankaroute_is_round_trip');
    return saved !== null ? saved === 'true' : false;
  });
  const [mobileCollapsed, setMobileCollapsed] = useState(false);
  const [gpsLoading, setGpsLoading] = useState(false);
  
  const [mobileScreen, setMobileScreen] = useState(() => {
    return window.innerWidth <= 768 ? 'home' : null;
  });

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth > 768) {
        setMobileScreen(null);
      } else if (mobileScreen === null) {
        setMobileScreen('home');
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [mobileScreen]);

  // Handle hardware back button for mobile navigation
  useEffect(() => {
    const handlePopState = (event) => {
      if (window.innerWidth <= 768) {
        if (event.state && event.state.screen) {
          setMobileScreen(event.state.screen);
          setActiveTab(event.state.screen);
        } else {
          setMobileScreen('home');
        }
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Sri Lanka Historical Place Explorer states
  const [activeTab, setActiveTab] = useState(() => {
    return localStorage.getItem('lankaroute_active_tab') || 'planner';
  });
  const [wikiSearchQuery, setWikiSearchQuery] = useState('');
  const [wikiSuggestions, setWikiSuggestions] = useState([]);
  const [wikiLoading, setWikiLoading] = useState(false);
  const [wikiArticle, setWikiArticle] = useState(null);
  const [wikiLanguage, setWikiLanguage] = useState('en');
  const [activeWikiImageIndex, setActiveWikiImageIndex] = useState(0);

  // AI Voice Guide logic
  const handleSpeechStop = () => {
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    if (window.aiVoiceAudio) {
      window.aiVoiceAudio.pause();
    }
    window.aiVoiceChunks = [];
    setIsSpeaking(false);
    setSpeechPaused(false);
  };

  const handleSpeechToggle = () => {
    if (isSpeaking) {
      if (speechPaused) {
        if (window.aiVoiceAudio && wikiLanguage === 'si') {
           window.aiVoiceAudio.play();
        } else {
           window.speechSynthesis.resume();
        }
        setSpeechPaused(false);
      } else {
        if (window.aiVoiceAudio && wikiLanguage === 'si') {
           window.aiVoiceAudio.pause();
        } else {
           window.speechSynthesis.pause();
        }
        setSpeechPaused(true);
      }
    } else {
      const article = wikiLanguage === 'si' ? wikiArticle.si : wikiArticle.en;
      if (!article || !article.sections || article.sections.length === 0) return;
      
      const validSections = article.sections.filter(s => !s.isRaw);
      
      const speakText = validSections.map(s => {
          let spokenTitle = s.title;
          if (wikiLanguage === 'si') {
              spokenTitle = spokenTitle.replace(/\(.*?\)/g, '').replace(/[a-zA-Z]/g, '').trim();
          }
          return `${spokenTitle}. ${s.content}`;
      }).join(wikiLanguage === 'si' ? " ---PAUSE---. " : " ");
      const cleanText = speakText.replace(/#/g, '').replace(/•/g, '').replace(/\*/g, '');
      
      if (wikiLanguage === 'si') {
          // Google Translate TTS fallback for Sinhala
          // Smart Chunking Algorithm by Sentences (Prevents mid-sentence delays)
          const rawChunks = cleanText.replace(/([.!?])\s+/g, "$1|").split("|");
          const chunks = [];
          
          rawChunks.forEach(sentence => {
              let s = sentence.trim();
              if (!s) return;
              
              if (s.length < 110) {
                  chunks.push(s);
              } else {
                  const parts = s.split(/,| සහ | හා | නිසා | බැවින් |\n/);
                  let temp = "";
                  for (let i = 0; i < parts.length; i++) {
                      let p = parts[i].trim();
                      if (!p) continue;
                      if (temp.length + p.length < 110) {
                          temp += (temp ? " " : "") + p;
                      } else {
                          if (temp) chunks.push(temp.trim());
                          temp = p;
                      }
                  }
                  if (temp) chunks.push(temp.trim());
              }
          });
          
          window.aiVoiceChunks = chunks.filter(c => c.length > 0);
          window.aiVoiceIndex = 0;

          if (!window.aiVoiceAudio) {
              window.aiVoiceAudio = new Audio();
          }
          
          const playNext = () => {
              if (window.aiVoiceIndex >= window.aiVoiceChunks.length) {
                  setIsSpeaking(false);
                  setSpeechPaused(false);
                  return;
              }
              const chunk = window.aiVoiceChunks[window.aiVoiceIndex];
              
              // Handle artificial pause marker between sections
              if (chunk.includes("---PAUSE---")) {
                  window.aiVoiceIndex++;
                  setTimeout(playNext, 1200); // 1.2 second pause between sections
                  return;
              }
              
              const url = `https://translate.googleapis.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(chunk)}&tl=si&client=tw-ob`;
              
              window.aiVoiceAudio.src = url;
              window.aiVoiceAudio.load(); // Force load
              
              // Sequentially preload the NEXT chunk only to prevent rate limits
              if (window.aiVoiceIndex + 1 < window.aiVoiceChunks.length) {
                  const nextChunk = window.aiVoiceChunks[window.aiVoiceIndex + 1];
                  const nextUrl = `https://translate.googleapis.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(nextChunk)}&tl=si&client=tw-ob`;
                  fetch(nextUrl, {mode: 'no-cors'}).catch(() => {});
              }
              
              window.aiVoiceAudio.onended = () => {
                  window.aiVoiceIndex++;
                  playNext(); // Immediately play next since it's already cached!
              };
              window.aiVoiceAudio.onerror = (e) => {
                  console.warn("TTS Error, skipping chunk:", chunk);
                  window.aiVoiceIndex++;
                  setTimeout(playNext, 50);
              };
              
              // We need a slight delay before calling play() when src changes
              setTimeout(() => {
                  window.aiVoiceAudio.play().catch(e => {
                      console.warn("Audio play blocked", e);
                      window.aiVoiceIndex++;
                      setTimeout(playNext, 50);
                  });
              }, 20);
          };
          
          setIsSpeaking(true);
          setSpeechPaused(false);
          playNext();
      } else {
          // Native TTS for English (with chunking to prevent long-text silent failures)
          window.speechSynthesis.cancel();
          
          // Split by sentences for English to prevent the 15-second utterance limit bug in browsers
          const rawChunks = cleanText.replace(/([.!?])\s+/g, "$1|").split("|");
          const chunks = rawChunks.map(c => c.trim()).filter(c => c.length > 0);
          
          window.aiVoiceChunks = chunks;
          window.aiVoiceIndex = 0;
          
          const playNext = () => {
              if (window.aiVoiceIndex >= window.aiVoiceChunks.length) {
                  setIsSpeaking(false);
                  setSpeechPaused(false);
                  return;
              }
              
              const chunk = window.aiVoiceChunks[window.aiVoiceIndex];
              const utterance = new SpeechSynthesisUtterance(chunk);
              utterance.lang = 'en-US';
              utterance.rate = 0.9;
              
              const voices = window.speechSynthesis.getVoices();
              const enVoice = voices.find(v => v.lang === 'en-US' || v.lang.includes('en'));
              if (enVoice) utterance.voice = enVoice;
              
              utterance.onend = () => {
                  window.aiVoiceIndex++;
                  playNext();
              };
              
              utterance.onerror = (e) => {
                  console.warn('Speech error on chunk:', e);
                  window.aiVoiceIndex++;
                  setTimeout(playNext, 50);
              };
              
              window.speechSynthesis.speak(utterance);
          };

          setTimeout(() => {
              setIsSpeaking(true);
              setSpeechPaused(false);
              playNext();
          }, 50);
      }
    }
  };

  useEffect(() => {
    return () => {
      handleSpeechStop();
    };
  }, []);

  // Sync state values back to LocalStorage
  useEffect(() => {
    try {
      localStorage.setItem('lankaroute_waypoints', JSON.stringify(waypoints));
    } catch (e) {
      console.warn('Failed to save waypoints to localStorage:', e);
    }
  }, [waypoints]);

  useEffect(() => {
    localStorage.setItem('lankaroute_active_tab', activeTab);
  }, [activeTab]);

  useEffect(() => {
    localStorage.setItem('lankaroute_selected_vehicle', selectedVehicle);
  }, [selectedVehicle]);

  useEffect(() => {
    localStorage.setItem('lankaroute_map_theme', mapTheme);
  }, [mapTheme]);

  useEffect(() => {
    localStorage.setItem('lankaroute_is_auto_optimize', String(isAutoOptimize));
  }, [isAutoOptimize]);

  useEffect(() => {
    localStorage.setItem('lankaroute_is_round_trip', String(isRoundTrip));
  }, [isRoundTrip]);

  useEffect(() => {
    localStorage.setItem('lankaroute_rate_per_km', String(ratePerKm));
    localStorage.setItem('lankaroute_accommodation_cost', String(accommodationCost));
    localStorage.setItem('lankaroute_food_cost', String(foodCost));
    localStorage.setItem('lankaroute_other_cost', String(otherCost));
    localStorage.setItem('lankaroute_num_travelers', String(numTravelers));
  }, [ratePerKm, accommodationCost, foodCost, otherCost, numTravelers]);

  // Derived state for selected route statistics
  const activeRoute = routeOptions[selectedRouteIndex];
  const profile = VEHICLE_PROFILES[selectedVehicle];
  const totalDistance = activeRoute ? activeRoute.distanceKm : 0;
  const totalDuration = activeRoute ? activeRoute.durationHrs * profile.speedFactor : 0;
  const isFallbackRoute = activeRoute ? activeRoute.isFallback : false;

  // Find shortest and fastest route indices dynamically
  let shortestRouteIndex = -1;
  let fastestRouteIndex = -1;
  if (routeOptions && routeOptions.length > 0) {
    let minDistance = Infinity;
    let minDuration = Infinity;
    routeOptions.forEach((r, idx) => {
      if (r.distanceKm < minDistance) {
        minDistance = r.distanceKm;
        shortestRouteIndex = idx;
      }
      if (r.durationHrs < minDuration) {
        minDuration = r.durationHrs;
        fastestRouteIndex = idx;
      }
    });
  }

  // Derived state for budget calculations
  const vehicleCost = totalDistance * ratePerKm;
  const totalTripCost = vehicleCost + Number(accommodationCost) + Number(foodCost) + Number(otherCost);
  const costPerPerson = numTravelers > 0 ? totalTripCost / numTravelers : totalTripCost;

  // Refs for Map
  const mapInstanceRef = useRef(null);
  const tileLayerRef = useRef(null);
  const markersLayerRef = useRef(null);
  const routeLayerRef = useRef(null);
  const poisLayerRef = useRef(null);
  const searchTimeoutRef = useRef(null);
  const poiTimeoutRef = useRef(null);

  // Initialize Map
  useEffect(() => {
    if (!mapInstanceRef.current) {
      // Create Leaflet map instance centered on Sri Lanka
      const map = L.map('map-container', {
        zoomControl: false
      }).setView([7.8731, 80.7718], 8);

      // Add elegant custom-positioned zoom buttons
      L.control.zoom({ position: 'topright' }).addTo(map);

      // Create active tile layer ref (Dark theme as initial style)
      const initialUrl = mapTheme === 'dark'
        ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
        : 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';

      const tileLayer = L.tileLayer(initialUrl, {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 20
      }).addTo(map);

      tileLayerRef.current = tileLayer;

      mapInstanceRef.current = map;
      markersLayerRef.current = L.layerGroup().addTo(map);
      routeLayerRef.current = L.layerGroup().addTo(map);
      poisLayerRef.current = L.layerGroup().addTo(map);

      // Map Click Handler to add custom pins
      map.on('click', async (e) => {
        if (window.leafletClickHandled) {
          window.leafletClickHandled = false;
          return;
        }
        const { lat, lng } = e.latlng;
        handleMapClick(lat, lng);
      });

      // Map Move/Zoom Handler to fetch local POIs dynamically
      map.on('moveend', () => {
        handleMapMove();
      });
    }

    return () => {
      // Retain the single map instance on hot reloads
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Dynamically Switch Map Theme (Light Voyager / Dark Matter)
  useEffect(() => {
    if (mapInstanceRef.current && tileLayerRef.current) {
      // Remove old layer
      mapInstanceRef.current.removeLayer(tileLayerRef.current);

      const newUrl = mapTheme === 'dark' 
        ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
        : 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';

      tileLayerRef.current = L.tileLayer(newUrl, {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 20
      }).addTo(mapInstanceRef.current);
    }
  }, [mapTheme]);

  // Bridge raw Leaflet HTML popups with React state triggers
  useEffect(() => {
    window.removeWaypointFromMap = (id) => {
      setWaypoints(prev => {
        const updated = prev.filter(w => w.id !== id);
        // Maintain locked starts if appropriate
        if (updated.length > 0) {
          updated[0].isLocked = true; // Always lock start point
        }
        return updated;
      });
      resetOptimization();
    };

    window.addPoiToTrip = (id) => {
      setPois(currentPois => {
        const foundPoi = currentPois.find(p => p.id.toString() === id.toString());
        if (foundPoi) {
          setWaypoints(prevWps => {
            const newWp = {
              id: generateId('poi-'),
              name: foundPoi.name,
              lat: foundPoi.lat,
              lng: foundPoi.lng,
              isLocked: prevWps.length === 0,
              isEnd: false
            };
            return alignStartAndEnd([...prevWps, newWp]);
          });
          resetOptimization();
        }
        return currentPois;
      });
    };

    return () => {
      delete window.removeWaypointFromMap;
      delete window.addPoiToTrip;
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
      if (poiTimeoutRef.current) {
        clearTimeout(poiTimeoutRef.current);
      }
    };
  }, []);

  // Auto-detect GPS Current Location on Startup
  useEffect(() => {
    // Small delay to let Leaflet paint the map container first
    const timer = setTimeout(() => {
      triggerGPSLocation(true); // silent auto-detect on startup
    }, 1000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Recalculate Leaflet Map size when tab changes back to planner
  useEffect(() => {
    if (activeTab === 'planner' && mapInstanceRef.current) {
      setTimeout(() => {
        mapInstanceRef.current.invalidateSize();
      }, 100);
    }
  }, [activeTab]);

  // Sync Markers and Driving Route Polylines to Map
  useEffect(() => {
    if (!mapInstanceRef.current || !markersLayerRef.current || !routeLayerRef.current) return;

    markersLayerRef.current.clearLayers();
    routeLayerRef.current.clearLayers();

    const activeList = optimizedWaypoints.length > 0 ? optimizedWaypoints : waypoints;

    if (activeList.length === 0) return;

    // 1. Draw Destination Markers
    activeList.forEach((wp, index) => {
      let pinClass = 'bg-stop';
      let label = index + 1;

      if (index === 0) {
        pinClass = 'bg-start';
        label = 'Start';
      } else if (wp.isLocked) {
        pinClass = 'bg-base';
        label = `Lock ${index + 1}`;
      } else if (index === activeList.length - 1 && !isRoundTrip) {
        pinClass = 'bg-end';
        label = 'End';
      }

      const icon = L.divIcon({
        className: `custom-map-pin ${pinClass}`,
        html: `<span>${typeof label === 'number' ? label : label[0]}</span>`,
        iconSize: [26, 26],
        iconAnchor: [13, 13]
      });

      const marker = L.marker([wp.lat, wp.lng], { icon })
        .bindPopup(`
          <div class="popup-card">
            <div class="popup-type">${index === 0 ? 'Home / Starting Point' : wp.isLocked ? 'Locked Station' : 'Stop ' + (index + 1)}</div>
            <div class="popup-title">${wp.name}</div>
            <button class="popup-btn" onclick="window.removeWaypointFromMap('${wp.id}')">Remove Stop</button>
          </div>
        `);

      markersLayerRef.current.addLayer(marker);
    });

    // 2. Fit Bounds of map to show all coordinates
    const bounds = L.latLngBounds(activeList.map(w => [w.lat, w.lng]));
    mapInstanceRef.current.fitBounds(bounds, { padding: [50, 50], maxZoom: 14 });

    // 3. Draw Road Routing Polylines (Multi-route options)
    if (routeOptions.length > 0) {
      routeOptions.forEach((route, index) => {
        const isSelected = index === selectedRouteIndex;
        
        // Selected route is cyan, alternative routes are semi-transparent violet
        const polyline = L.polyline(route.path, {
          color: isSelected ? '#06b6d4' : 'rgba(139, 92, 246, 0.45)',
          weight: isSelected ? 5.5 : 4.0,
          opacity: isSelected ? 0.9 : 0.5,
          lineCap: 'round',
          lineJoin: 'round',
          dashArray: route.isFallback ? '8, 8' : (!isSelected ? '6, 6' : null),
          zIndexOffset: isSelected ? 1000 : 10
        });

        // Click a route line on the map to select it directly!
        polyline.on('click', (e) => {
          if (e && e.originalEvent) {
            L.DomEvent.stopPropagation(e.originalEvent);
          }
          window.leafletClickHandled = true;
          setTimeout(() => {
            window.leafletClickHandled = false;
          }, 100);
          setSelectedRouteIndex(index);
        });

        routeLayerRef.current.addLayer(polyline);
      });
    }
  }, [waypoints, optimizedWaypoints, routeOptions, selectedRouteIndex, isRoundTrip]);

  // Debounced Map Move / Zoom Handler to dynamically fetch local POIs (restaurants, hotels, sights)
  const handleMapMove = () => {
    if (!mapInstanceRef.current) return;
    const zoom = mapInstanceRef.current.getZoom();
    
    // Clear previous timeout
    if (poiTimeoutRef.current) {
      clearTimeout(poiTimeoutRef.current);
    }

    if (zoom < 13) {
      setPois([]); // Clear POIs if zoom is too low to prevent map clutter
      return;
    }

    // 800ms Debounce to prevent API spam while dragging
    poiTimeoutRef.current = setTimeout(async () => {
      const bounds = mapInstanceRef.current.getBounds();
      const south = bounds.getSouth();
      const west = bounds.getWest();
      const north = bounds.getNorth();
      const east = bounds.getEast();

      // Ensure bounding box isn't excessively large to save Overpass resources
      if (Math.abs(north - south) > 0.15 || Math.abs(east - west) > 0.15) {
        return;
      }

      try {
        const query = `[out:json][timeout:15];
(
  node["amenity"="place_of_worship"](${south},${west},${north},${east});
  node["historic"](${south},${west},${north},${east});
  node["tourism"="attraction"](${south},${west},${north},${east});
  node["tourism"="hotel"](${south},${west},${north},${east});
  node["tourism"="resort"](${south},${west},${north},${east});
  node["tourism"="guest_house"](${south},${west},${north},${east});
  node["amenity"="restaurant"](${south},${west},${north},${east});
  node["amenity"="cafe"](${south},${west},${north},${east});
  node["tourism"="viewpoint"](${south},${west},${north},${east});
  node["waterway"="waterfall"](${south},${west},${north},${east});
  node["amenity"="fuel"](${south},${west},${north},${east});
);
out body 40;`;

        const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          const items = (data.elements || [])
            .filter(el => el.tags && el.tags.name)
            .map(el => {
              let category = 'attraction';
              const t = el.tags;
              if (t.historic || t.amenity === 'place_of_worship' || t.religion === 'buddhist' || t.religion === 'hindu') {
                category = 'temple';
              } else if (t.tourism === 'hotel' || t.tourism === 'resort' || t.tourism === 'guest_house' || t.tourism === 'hostel' || t.tourism === 'motel') {
                category = 'hotel';
              } else if (t.amenity === 'restaurant' || t.amenity === 'cafe' || t.amenity === 'fast_food' || t.amenity === 'food_court') {
                category = 'restaurant';
              } else if (t.tourism === 'viewpoint' || t.waterway === 'waterfall' || t.leisure === 'park' || t.natural === 'peak') {
                category = 'nature';
              } else if (t.amenity === 'fuel') {
                category = 'fuel';
              }

              return {
                id: el.id,
                name: t.name,
                lat: el.lat,
                lng: el.lon,
                category,
                details: t.description || t.historic || t.tourism || t.amenity || ''
              };
            });
          setPois(items);
        }
      } catch (err) {
        console.warn('Overpass POI lookup failed:', err);
      }
    }, 800);
  };

  // Sync POI Markers (Icons + Names conditionally on Zoom) to Map
  useEffect(() => {
    if (!mapInstanceRef.current || !poisLayerRef.current) return;

    poisLayerRef.current.clearLayers();

    if (pois.length === 0) return;

    const zoom = mapInstanceRef.current.getZoom();
    const showLabel = zoom >= 15; // Only show text labels on zoom level >= 15

    pois.forEach((poi) => {
      let pinClass;
      let symbol;

      if (poi.category === 'temple') {
        pinClass = 'poi-temple';
        symbol = '🛕';
      } else if (poi.category === 'hotel') {
        pinClass = 'poi-hotel';
        symbol = '🏨';
      } else if (poi.category === 'restaurant') {
        pinClass = 'poi-restaurant';
        symbol = '🍴';
      } else if (poi.category === 'nature') {
        pinClass = 'poi-nature';
        symbol = '🌲';
      } else if (poi.category === 'fuel') {
        pinClass = 'poi-fuel';
        symbol = '⛽';
      } else {
        pinClass = 'poi-attraction';
        symbol = '📍';
      }

      // Design custom divIcon that includes a clean label if zoomed in
      const icon = L.divIcon({
        className: `custom-poi-marker ${pinClass}`,
        html: `
          <div class="poi-marker-bubble">
            <span>${symbol}</span>
          </div>
          ${showLabel ? `<div class="poi-marker-label">${poi.name}</div>` : ''}
        `,
        iconSize: [32, showLabel ? 60 : 32],
        iconAnchor: [16, 16]
      });

      const marker = L.marker([poi.lat, poi.lng], { icon })
        .bindPopup(`
          <div class="popup-card">
            <div class="popup-type">${poi.category.toUpperCase()}</div>
            <div class="popup-title">${poi.name}</div>
            ${poi.details ? `<div class="popup-desc">${poi.details.replace(/_/g, ' ')}</div>` : ''}
            <button class="popup-btn popup-btn-add" onclick="window.addPoiToTrip('${poi.id}')">➕ Add to Itinerary</button>
          </div>
        `);

      poisLayerRef.current.addLayer(marker);
    });
  }, [pois]);

  // Geolocation trigger function
  function triggerGPSLocation(isStartup = false) {
    if (!navigator.geolocation) {
      if (!isStartup) alert('Geolocation is not supported by your browser.');
      return;
    }

    setGpsLoading(true);

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;

        // Zoom the map to GPS position
        if (mapInstanceRef.current) {
          mapInstanceRef.current.setView([latitude, longitude], 13);
        }

        const tempId = generateId('gps-start-');
        const gpsWp = {
          id: tempId,
          name: 'Locating address...',
          lat: latitude,
          lng: longitude,
          isLocked: true // Locked as start
        };

        setWaypoints(prev => {
          // If empty (on startup) or triggered manually, place at index 0 as Start Point!
          if (prev.length === 0) {
            return [gpsWp];
          } else if (!isStartup) {
            // If manual click, replace the starting point or insert at index 0
            const filtered = prev.filter(w => !w.id.startsWith('gps-start'));
            // Remove previous locks on other starting points
            const cleaned = filtered.map((w, idx) => idx === 0 ? { ...w, isLocked: false } : w);
            return [gpsWp, ...cleaned];
          }
          return prev;
        });
        resetOptimization();

        // Perform reverse geocoding to resolve street/attraction address details
        try {
          const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=16`;
          const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
          if (res.ok) {
            const data = await res.json();
            const address = data.address || {};
            
            // Resolve premium readable localized place name
            const place = data.name || address.road || address.suburb || address.village || address.city || 'My Location';
            const district = address.state_district || address.state || '';
            const cleanLabel = district 
              ? `My Location (${place}, ${district.replace(' District', '')})` 
              : `My Location (${place})`;

            setWaypoints(prev => prev.map(w => w.id === tempId ? { ...w, name: cleanLabel } : w));
          } else {
            setWaypoints(prev => prev.map(w => w.id === tempId ? { ...w, name: 'My Location' } : w));
          }
        } catch (err) {
          console.warn('Reverse geocoding failed:', err);
          setWaypoints(prev => prev.map(w => w.id === tempId ? { ...w, name: 'My Location' } : w));
        } finally {
          setGpsLoading(false);
        }
      },
      (error) => {
        console.warn('GPS position lookup failed or denied:', error);
        setGpsLoading(false);
        // Fallback for developers outside Sri Lanka or in test runners
        if (!isStartup && error.code === error.PERMISSION_DENIED) {
          alert('GPS location permission denied. Please enable location permissions.');
        }
      },
      { enableHighAccuracy: true, timeout: 7000 }
    );
  };

  // Autocomplete Geocoding Search (restricted to Sri Lanka)
  const handleSearchChange = (e) => {
    const val = e.target.value;
    setSearchQuery(val);

    if (val.trim().length < 3) {
      setSuggestions([]);
      return;
    }

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    setIsSearching(true);

    searchTimeoutRef.current = setTimeout(async () => {
      try {
        // Try Photon first (fast, fuzzy, no rate limit)
        const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(val)}&lat=7.8731&lon=80.7718&limit=15`;
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          // Filter LK and map to structured objects
          const results = (data.features || [])
            .filter(f => f.properties && f.properties.countrycode === 'LK')
            .map(f => {
              const p = f.properties;
              const subtitleParts = [p.district, p.city, p.county, p.state]
                .filter(Boolean)
                .map(s => s.replace(' District', ''));
              // Remove duplicates
              const uniqueParts = [...new Set(subtitleParts)];
              
              return {
                name: p.name || p.street || 'Location',
                subtitle: uniqueParts.slice(0, 2).join(', '),
                lat: f.geometry.coordinates[1],
                lng: f.geometry.coordinates[0]
              };
            });

          if (results.length > 0) {
            setSuggestions(results);
            setIsSearching(false);
            return;
          }
        }
      } catch (err) {
        console.warn('Photon lookup failed, falling back to Nominatim:', err);
      }

      // Fallback to Nominatim if Photon fails or returns empty
      try {
        const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(val)}&countrycodes=lk&limit=6&addressdetails=1`;
        const res = await fetch(url, {
          headers: {
            'Accept-Language': 'en',
            'User-Agent': 'LankaRoute/1.0'
          }
        });
        if (res.ok) {
          const data = await res.json();
          const results = data.map(item => {
            const parts = item.display_name.split(',');
            const placeName = parts[0].trim();
            const regionDesc = parts.slice(1, 3).join(',').trim();
            return {
              name: placeName,
              subtitle: regionDesc,
              lat: parseFloat(item.lat),
              lng: parseFloat(item.lon)
            };
          });
          setSuggestions(results);
        }
      } catch (err) {
        console.error('Nominatim Fallback Geocoding Error:', err);
      } finally {
        setIsSearching(false);
      }
    }, 400); // 400ms debounce
  };

  // Add waypoint from geocoding suggestions (supports specific attractions/temples)
  const addWaypointFromSuggestion = (item) => {
    const cleanName = item.subtitle ? `${item.name}, ${item.subtitle.split(',')[0]}` : item.name;

    const newWp = {
      id: generateId(),
      name: cleanName,
      lat: item.lat,
      lng: item.lng,
      isLocked: waypoints.length === 0, // Start point is locked by default
      isEnd: false
    };

    setWaypoints(prev => alignStartAndEnd([...prev, newWp]));
    setSearchQuery('');
    setSuggestions([]);
    resetOptimization();
    setMobileCollapsed(true);
  };

  // Add waypoint directly by clicking on map
  const handleMapClick = async (lat, lng) => {
    const tempId = generateId('map-');
    const tempName = `Location (${lat.toFixed(4)}, ${lng.toFixed(4)})`;

    const newWp = {
      id: tempId,
      name: tempName,
      lat,
      lng,
      isLocked: waypoints.length === 0, // Start point locked by default
      isEnd: false
    };

    setWaypoints(prev => alignStartAndEnd([...prev, newWp]));
    resetOptimization();

    // Reverse geocoding lookups in background
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=14`;
      const res = await fetch(url, {
        headers: {
          'Accept-Language': 'en'
        }
      });
      if (res.ok) {
        const data = await res.json();
        const address = data.address || {};
        const placeName = data.name || address.road || address.suburb || address.village || address.city || 'Custom Location';
        const districtName = address.state_district || address.state || '';
        const cleanName = districtName ? `${placeName}, ${districtName.replace(' District', '')}` : placeName;

        setWaypoints(prev => prev.map(w => w.id === tempId ? { ...w, name: cleanName } : w));
      }
    } catch (err) {
      console.warn('Reverse geocoding failed:', err);
    }
  };

  // Add hotspot destinations rapidly
  const addHotspot = (hotspot) => {
    const newWp = {
      id: generateId('hotspot-'),
      name: hotspot.name,
      lat: hotspot.lat,
      lng: hotspot.lng,
      isLocked: waypoints.length === 0,
      isEnd: false
    };

    setWaypoints(prev => alignStartAndEnd([...prev, newWp]));
    resetOptimization();
    setMobileCollapsed(true);
  };

  // Lock or unlock an individual waypoint's position in the itinerary
  const toggleLockWaypoint = (id) => {
    setWaypoints(prev => prev.map((w, idx) => {
      if (w.id === id) {
        // If it is the first waypoint (Start), it MUST remain locked
        if (idx === 0) return { ...w, isLocked: true };
        return { ...w, isLocked: !w.isLocked };
      }
      return w;
    }));
    resetOptimization();
  };

  // Set or unset a waypoint as the designated End Location
  const handleSetEndWaypoint = (id) => {
    setWaypoints(prev => {
      const updated = prev.map(w => {
        if (w.id === id) {
          const newIsEnd = !w.isEnd;
          return { ...w, isEnd: newIsEnd, isLocked: newIsEnd ? true : w.isLocked };
        }
        return w.isEnd ? { ...w, isEnd: false, isLocked: false } : w;
      });
      return alignStartAndEnd(updated);
    });
    setIsRoundTrip(false); // Turn off round-trip if they have a custom end location
    resetOptimization();
  };

  // Manual move items up or down
  const moveWaypoint = (index, direction) => {
    const target = index + direction;
    if (target < 0 || target >= waypoints.length) return;

    const reordered = [...waypoints];
    const temp = reordered[index];
    reordered[index] = reordered[target];
    reordered[target] = temp;

    // Enforce first item is locked
    reordered.forEach((w, i) => {
      if (i === 0) w.isLocked = true;
    });

    setWaypoints(alignStartAndEnd(reordered));
    resetOptimization();
  };

  // Delete an item from the itinerary
  const deleteWaypoint = (id) => {
    setWaypoints(prev => {
      const updated = prev.filter(w => w.id !== id);
      if (updated.length > 0) {
        updated[0].isLocked = true; // Lock start
      }
      return alignStartAndEnd(updated);
    });
    resetOptimization();
  };

  // Clear all itinerary entries
  const clearItinerary = () => {
    setWaypoints([]);
    resetOptimization();
    // Also reset budget inputs and options for a clean fresh start
    setAccommodationCost(0);
    setFoodCost(0);
    setOtherCost(0);
    setNumTravelers(1);
    setRatePerKm(120);
    setIsRoundTrip(false);
  };

  // Reset optimization routes and stats
  function resetOptimization() {
    setOptimizedWaypoints([]);
    setRouteOptions([]);
    setSelectedRouteIndex(0);
  };

  // Autocomplete search handler for Wikipedia Explorer
  const handleWikiSearchChange = (e) => {
    const val = e.target.value;
    setWikiSearchQuery(val);

    if (val.trim().length < 3) {
      setWikiSuggestions([]);
      return;
    }

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    setWikiLoading(true);

    searchTimeoutRef.current = setTimeout(async () => {
      try {
        const isSi = /[\u0D80-\u0DFF]/.test(val);
        const wikiDomain = isSi ? 'si.wikipedia.org' : 'en.wikipedia.org';
        const wikiQuery = isSi ? val : val + ' Sri Lanka';
        
        const wikiUrl = `https://${wikiDomain}/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(wikiQuery)}&gsrlimit=8&prop=coordinates|extracts&exchars=150&exintro=1&explaintext=1&format=json&origin=*`;
        const nomUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(val)}&countrycodes=lk&limit=5&accept-language=${isSi ? 'si' : 'en'}`;
        const photonUrl = `https://photon.komoot.io/api/?q=${encodeURIComponent(val)}&lat=7.8731&lon=80.7718&limit=5`;
        
        const [wikiRes, nomRes, photonRes] = await Promise.all([
          fetch(wikiUrl).catch(() => ({ ok: false })),
          fetch(nomUrl).catch(() => ({ ok: false })),
          fetch(photonUrl).catch(() => ({ ok: false }))
        ]);
        
        let combined = [];

        if (wikiRes.ok) {
          const wikiData = await wikiRes.json();
          const pages = Object.values(wikiData.query?.pages || {});
          const places = pages.filter(p => p.coordinates);
          places.sort((a, b) => a.index - b.index);
          
          combined = places.map(item => ({
            title: item.title,
            snippet: item.extract ? item.extract.substring(0, 100) + '...' : '',
            source: 'wikipedia'
          }));
        }
        
        let geoList = [];
        
        if (photonRes.ok) {
          const photonData = await photonRes.json();
          geoList = (photonData.features || [])
            .filter(f => f.properties && f.properties.countrycode === 'LK')
            .map(f => ({
              title: f.properties.name || f.properties.street || 'Location',
              snippet: [f.properties.district, f.properties.city, f.properties.state].filter(Boolean).join(', ').replace(/ District/g, ''),
              source: 'photon',
              lat: f.geometry.coordinates[1],
              lon: f.geometry.coordinates[0],
              osm_type: f.properties.osm_type,
              osm_id: f.properties.osm_id
            }));
        }
        
        if (nomRes.ok && geoList.length === 0) {
          const nomData = await nomRes.json();
          geoList = nomData.map(item => ({
            title: item.name || item.display_name.split(',')[0],
            snippet: item.display_name,
            source: 'nominatim',
            lat: parseFloat(item.lat),
            lon: parseFloat(item.lon),
            osm_type: item.osm_type,
            osm_id: item.osm_id
          }));
        }
          
        const existingTitles = new Set(combined.map(c => c.title.toLowerCase()));
        geoList.forEach(n => {
          if (!existingTitles.has(n.title.toLowerCase())) {
            combined.push(n);
            existingTitles.add(n.title.toLowerCase());
          }
        });
        
        setWikiSuggestions(combined);
      } catch (err) {
        console.error('Search error:', err);
      } finally {
        setWikiLoading(false);
      }
    }, 400);
  };

  // Fetch full Wikipedia article details (both English and native Sinhala if available)
  const loadWikiArticle = async (suggestion) => {
    const title = typeof suggestion === 'string' ? suggestion : suggestion.title;
    const isNominatim = typeof suggestion === 'object' && suggestion.source === 'nominatim';
    const nomCoords = isNominatim ? { lat: suggestion.lat, lon: suggestion.lon } : null;

    handleSpeechStop(); // Stop any currently playing audio when a new article is loading
    setWikiLoading(true);
    setActiveWikiImageIndex(0);
    setWikiLanguage('en'); // Reset default language to English when loading a new article
    try {
      const isSi = /[\u0D80-\u0DFF]/.test(title);
      const primaryDomain = isSi ? 'si.wikipedia.org' : 'en.wikipedia.org';
      const secondaryLang = isSi ? 'en' : 'si';
      
      const detailsUrl = `https://${primaryDomain}/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(title)}&gsrlimit=1&prop=extracts|coordinates|pageimages|langlinks&lllang=${secondaryLang}&explaintext=1&pithumbsize=800&format=json&origin=*&redirects=1`;
      const detailsRes = await fetch(detailsUrl);
      if (!detailsRes.ok) throw new Error('Failed to load article details');
      
      const detailsData = await detailsRes.json();
      const pages = detailsData.query?.pages || {};
      const pageId = Object.keys(pages)[0];
      if (pageId === '-1') {
        throw new Error('Article not found');
      }
      
      const page = pages[pageId];
      const primaryText = page.extract || '';
      const coordinates = page.coordinates?.[0] || nomCoords;
      const mainThumbnail = page.thumbnail?.source || null;

      const langlinks = page.langlinks || [];
      const secondaryTitleObj = langlinks.find(link => link.lang === secondaryLang);
      const secondaryTitle = secondaryTitleObj ? secondaryTitleObj['*'] : null;

      const enTitle = isSi ? secondaryTitle : page.title;
      const sinhalaTitle = isSi ? page.title : secondaryTitle;

      let enText = isSi ? '' : primaryText;
      let siText = isSi ? primaryText : '';

      if (secondaryTitle) {
        try {
          const secDomain = isSi ? 'en.wikipedia.org' : 'si.wikipedia.org';
          const secUrl = `https://${secDomain}/w/api.php?action=query&titles=${encodeURIComponent(secondaryTitle)}&prop=extracts&explaintext=1&format=json&origin=*&redirects=1`;
          const secRes = await fetch(secUrl);
          if (secRes.ok) {
            const secData = await secRes.json();
            const secPages = secData.query?.pages || {};
            const secPageId = Object.keys(secPages)[0];
            if (secPageId !== '-1') {
              const secExtract = secPages[secPageId].extract || '';
              if (isSi) enText = secExtract;
              else siText = secExtract;
            }
          }
        } catch (err) {
          console.warn('Failed to load secondary page content:', err);
        }
      }

      const parsedSections = parseWikiSections(enText, false);
      const parsedSinhalaSections = parseWikiSections(siText, true);
      
      // Fetch images using English title if available (Commons images are linked to en wiki more robustly)
      const imagesList = await fetchWikiImages(enTitle || sinhalaTitle || title);
      
      let allImages = [...imagesList];
      if (mainThumbnail && !allImages.includes(mainThumbnail)) {
        allImages = [mainThumbnail, ...allImages];
      }

      let stats = { builder: null, era: null, currentStatus: 'General Location' };
      try {
        stats = parseHistoricalStats(enText) || stats;
      } catch (e) {
        console.error('Error parsing stats:', e);
      }
      
      let sinhalaStats = null;
      if (siText) {
        sinhalaStats = translateStatsToSinhala(stats);
      }

      let enrichedSinhalaSections = [];
      try {
        enrichedSinhalaSections = getEnrichedSinhalaSections(sinhalaTitle || title, parsedSinhalaSections);
      } catch (e) {
        console.error('Error enriching Sinhala sections:', e);
      }

      let enStatusDesc = '';
      let finalSiStats = stats;
      let siStatusDesc = '';
      
      try {
        enStatusDesc = generateStatusDescription(stats.currentStatus, 'en');
        finalSiStats = sinhalaStats || translateStatsToSinhala(stats);
        siStatusDesc = generateStatusDescription(finalSiStats.currentStatus, 'si');
      } catch (e) {
        console.error('Error translating stats:', e);
      }

      // Fetch OSM extra tags
      let osmTags = null;
      if (typeof suggestion === 'object' && suggestion.osm_type && suggestion.osm_id) {
        try {
          const detUrl = `https://nominatim.openstreetmap.org/details?osmtype=${suggestion.osm_type.charAt(0).toUpperCase()}&osmid=${suggestion.osm_id}&format=json&extratags=1`;
          const detRes = await fetch(detUrl, { headers: { 'User-Agent': 'LankaRoute/1.0' } });
          if (detRes.ok) {
            const detData = await detRes.json();
            if (detData.extratags) {
              osmTags = detData.extratags;
            }
          }
        } catch(e) { console.warn('OSM Details error', e); }
      }

      // Fetch Wikivoyage data
      let wvText = '';
      try {
        const wvTarget = (typeof suggestion === 'object' && suggestion.snippet) 
           ? suggestion.snippet.split(',')[0] // Get the city/district
           : (enTitle || sinhalaTitle || title);
           
        const wvUrl = `https://en.wikivoyage.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(wvTarget)}&gsrlimit=1&prop=extracts&explaintext=1&format=json&origin=*`;
        const wvRes = await fetch(wvUrl);
        if (wvRes.ok) {
           const wvData = await wvRes.json();
           const wvPages = wvData.query?.pages || {};
           const wvPageId = Object.keys(wvPages)[0];
           if (wvPageId && wvPageId !== '-1') {
             wvText = wvPages[wvPageId].extract || '';
           }
        }
      } catch (err) {
        console.warn('Wikivoyage error:', err);
      }

      const wvSections = parseWikiSections(wvText);
      const usefulWvSections = wvSections.filter(s => 
         /Get in|See|Eat|Sleep|Drink|Go next|Do|Understand/i.test(s.title)
      );

      // Translate Wikivoyage content to Sinhala dynamically
      const translateToSinhala = async (text) => {
        if (!text) return '';
        try {
          const paragraphs = text.split('\n');
          const translatedParas = await Promise.all(paragraphs.map(async (p) => {
            if (!p.trim()) return '';
            const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=si&dt=t&q=${encodeURIComponent(p)}`;
            try {
              const res = await fetch(url);
              if (!res.ok) return p;
              const data = await res.json();
              if (data && data[0]) {
                return data[0].map(item => item[0]).join('');
              }
            } catch (err) { return p; }
            return p;
          }));
          return translatedParas.join('\n');
        } catch (e) {
          console.warn('Translation failed:', e);
          return text;
        }
      };

      const translatedWvSections = await Promise.all(
        usefulWvSections.map(async (sec) => {
           const translatedContent = await translateToSinhala(sec.content);
           return { ...sec, siContent: translatedContent };
        })
      );

      let osmEnContent = '';
      let osmSiContent = '';
      if (osmTags) {
        const formatRow = (labelEn, labelSi, val) => {
           if (!val) return '';
           osmEnContent += `• ${labelEn}: ${val}\n`;
           osmSiContent += `• ${labelSi}: ${val}\n`;
        };
        formatRow('Website', 'වෙබ් අඩවිය', osmTags.website);
        formatRow('Phone', 'දුරකථන අංකය', osmTags.phone || osmTags['contact:phone']);
        formatRow('Opening Hours', 'විවෘත වේලාවන්', osmTags.opening_hours);
        formatRow('Fee', 'ගාස්තු', osmTags.fee || osmTags.charge);
        formatRow('Wheelchair Access', 'රෝද පුටු පහසුකම්', osmTags.wheelchair);
        formatRow('Email', 'විද්‍යුත් තැපෑල', osmTags.email || osmTags['contact:email']);
      }

      // Append dynamic status sections
      const finalEnSections = [...parsedSections];
      if (enStatusDesc) {
        finalEnSections.push({ title: 'Current Status', content: enStatusDesc });
      }
      if (osmEnContent) {
        finalEnSections.push({ title: 'Quick Info (OpenStreetMap)', content: osmEnContent });
      }
      if (translatedWvSections.length > 0) {
        translatedWvSections.forEach(s => {
          finalEnSections.push({ title: `Travel Guide - ${s.title}`, content: s.content });
        });
      }
      
      const finalSiSections = [...enrichedSinhalaSections];
      if (siStatusDesc && !finalSiSections.some(s => s.title.includes('තත්ත්වය'))) {
        finalSiSections.push({ title: 'වර්තමාන තත්ත්වය (Current Status)', content: siStatusDesc });
      }
      if (osmSiContent) {
        finalSiSections.push({ title: 'අමතර තොරතුරු (Quick Info)', content: osmSiContent });
      }
      
      const translateWvTitle = (t) => {
        const lower = t.toLowerCase();
        if (lower.includes('get in')) return 'ගමන් මාර්ග (Get in)';
        if (lower.includes('see')) return 'නැරඹිය යුතු දෑ (See)';
        if (lower.includes('eat')) return 'ආහාර පාන (Eat)';
        if (lower.includes('sleep')) return 'නවාතැන් (Sleep)';
        if (lower.includes('drink')) return 'පානයන් (Drink)';
        if (lower.includes('go next')) return 'මීළඟ ගමනාන්ත (Go next)';
        if (lower.includes('do')) return 'කළ යුතු දෑ (Do)';
        if (lower.includes('understand')) return 'අවබෝධයක් (Understand)';
        if (lower.includes('buy')) return 'මිලදී ගැනීම් (Buy)';
        return t;
      };

      if (translatedWvSections.length > 0) {
        translatedWvSections.forEach(s => {
          finalSiSections.push({ title: `සංචාරක මඟපෙන්වීම - ${translateWvTitle(s.title)}`, content: s.siContent });
        });
      }

      setWikiArticle({
        title: page.title,
        mainImage: mainThumbnail,
        images: allImages.slice(0, 6),
        coordinates: coordinates,
        en: {
          title: page.title,
          sections: finalEnSections,
          stats: stats
        },
        si: {
          title: sinhalaTitle || title,
          sections: finalSiSections,
          stats: finalSiStats
        }
      });

      setWikiSearchQuery('');
      setWikiSuggestions([]);
    } catch (err) {
      console.error('Error loading wiki article:', err);
      // Fallback: Universal 'No Information' state instead of annoying alerts
      setWikiArticle({
        title: title,
        mainImage: null,
        images: [],
        coordinates: nomCoords,
        en: {
          title: title,
          sections: [{
            title: 'Information',
            content: 'Sufficient information has not been received from our sources for this specific location. However, you can still view it on the map and add it to your trip itinerary.'
          }],
          stats: { builder: null, era: null, currentStatus: 'General Location' }
        },
        si: {
          title: title,
          sections: [{
            title: 'තොරතුරු (Information)',
            content: 'මෙම ස්ථානය පිළිබඳව ප්‍රමාණවත් තොරතුරු අපගේ මූලාශ්‍ර වෙතින් ලැබී නොමැත. කෙසේ වෙතත්, ඔබට මෙය සිතියම මත බලා ඔබගේ ගමනට එක්කර ගත හැක.'
          }],
          stats: { builder: null, era: null, currentStatus: 'General Location' }
        }
      });
      setWikiSuggestions([]);
      setWikiSearchQuery('');
    } finally {
      setWikiLoading(false);
    }
  };

  // Add Wikipedia place to itinerary bridge
  const addWikiPlaceToItinerary = async () => {
    if (!wikiArticle) return;
    
    let lat = null;
    let lng = null;
    
    if (wikiArticle.coordinates) {
      lat = wikiArticle.coordinates.lat;
      lng = wikiArticle.coordinates.lon;
    } else {
      try {
        const searchRes = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(wikiArticle.title)}&lat=7.8731&lon=80.7718&limit=1`);
        if (searchRes.ok) {
          const data = await searchRes.json();
          const feat = data.features?.[0];
          if (feat && feat.properties && feat.properties.countrycode === 'LK') {
            lat = feat.geometry.coordinates[1];
            lng = feat.geometry.coordinates[0];
          }
        }
      } catch (e) {
        console.warn('Wiki place fallback geocoding failed:', e);
      }
    }
    
    const activeTitle = wikiLanguage === 'si' && wikiArticle.si ? wikiArticle.si.title : wikiArticle.en.title;

    if (lat && lng) {
      const newWp = {
        id: 'wiki-' + Date.now().toString() + Math.random().toString(36).substr(2, 5),
        name: activeTitle,
        lat: lat,
        lng: lng,
        isLocked: waypoints.length === 0,
        isEnd: false
      };
      setWaypoints(prev => alignStartAndEnd([...prev, newWp]));
      resetOptimization();
      setActiveTab('planner');
      setMobileCollapsed(true);
      alert(wikiLanguage === 'si' 
        ? `සාර්ථකයි: "${activeTitle}" ඔබේ සංචාරක මාර්ගයට එක් කරන ලදී!` 
        : `Success: "${activeTitle}" has been added to your trip waypoints!`);
    } else {
      alert(wikiLanguage === 'si'
        ? `"${activeTitle}" සඳහා භූගෝලීය ඛණ්ඩාංක සෙවීමට නොහැකි විය. කරුණාකර එය සිතියම මත ක්ලික් කර එක් කරන්න.`
        : `Unable to resolve location coordinates for "${activeTitle}". Please try adding it by searching in the Trip Planner.`);
    }
  };

  // Core OSRM-TSP Optimization pipeline
  const handleOptimize = async (vehicleOverride = null) => {
    if (waypoints.length < 2) return;
    setIsOptimizing(true);

    const activeVehicle = vehicleOverride || selectedVehicle;
    const profile = VEHICLE_PROFILES[activeVehicle];

    try {
      let optimizedList;
      if (isAutoOptimize) {
        // 1. Fetch distance matrices (durations and meters) from OSRM driving api
        const matrixData = await getOSRMMatrices(waypoints);
        if (!matrixData) throw new Error('Failed to assemble matrix');

        // 2. Perform TSP solving while strictly locking fixed positions
        optimizedList = optimizeRouteWithLocks(
          waypoints, 
          matrixData.durations, // optimize on travel durations (seconds)
          isRoundTrip
        );
        setOptimizedWaypoints(optimizedList);
      } else {
        optimizedList = waypoints;
        setOptimizedWaypoints([]);
      }

      // 3. Fetch full high-fidelity road geometry layout coordinates (including alternatives)
      const routes = await getOSRMRouteGeometry(optimizedList, isRoundTrip, profile.allowsExpressway);

      setRouteOptions(routes);
      setSelectedRouteIndex(0);
    } catch (error) {
      console.error('Routing optimization error:', error);
    } finally {
      setIsOptimizing(false);
    }
  };

  // Auto-recalculate route geometry and stats when travel vehicle type changes
  useEffect(() => {
    if (waypoints.length >= 2 && (optimizedWaypoints.length > 0 || !isAutoOptimize)) {
      const recalculateRoute = async () => {
        setIsOptimizing(true);
        const profile = VEHICLE_PROFILES[selectedVehicle];
        const activeList = optimizedWaypoints.length > 0 ? optimizedWaypoints : waypoints;
        try {
          const routes = await getOSRMRouteGeometry(activeList, isRoundTrip, profile.allowsExpressway);
          setRouteOptions(routes);
          // Retain index if still in bounds, otherwise reset to 0
          setSelectedRouteIndex(prev => prev < routes.length ? prev : 0);
        } catch (error) {
          console.error('Route recalculation error:', error);
        } finally {
          setIsOptimizing(false);
        }
      };
      recalculateRoute();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedVehicle, isAutoOptimize]);

  // Auto-optimize route sequence (TSP Shortest Path) whenever waypoints, round-trip or auto-optimize settings changes
  useEffect(() => {
    if (waypoints.length >= 2) {
      const timer = setTimeout(() => {
        handleOptimize();
      }, 400); // 400ms debounce to buffer consecutive rapid additions/clicks
      return () => clearTimeout(timer);
    } else {
      resetOptimization();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waypoints, isRoundTrip, isAutoOptimize]);

  // Render stats formatting helper
  const formatDuration = (hours) => {
    const totalMins = Math.round(hours * 60);
    const hrs = Math.floor(totalMins / 60);
    const mins = totalMins % 60;
    
    if (hrs === 0) return `${mins}m`;
    return `${hrs}h ${mins}m`;
  };

  const activeWaypoints = optimizedWaypoints.length > 0 ? optimizedWaypoints : waypoints;

  return (
    <div className="app-container">
      {mobileScreen === 'home' && (
        <div className="mobile-home-screen">
          <div className="home-brand">
            <h1>LankaRoute</h1>
            <p>Official Network of Sri Lanka Routes</p>
          </div>
          
          <div className="home-dashboard-grid">
            <button className="home-dashboard-card" onClick={() => { setActiveTab('planner'); setMobileScreen('planner'); setMobileCollapsed(false); window.history.pushState({ screen: 'planner' }, ''); }}>
              <div className="card-bg-overlay planner-bg"></div>
              <MapPin size={32} className="card-icon" />
              <span className="card-title">Trip Planner</span>
            </button>
            
            <button className="home-dashboard-card" onClick={() => { setActiveTab('explorer'); setMobileScreen('explorer'); setMobileCollapsed(false); window.history.pushState({ screen: 'explorer' }, ''); }}>
              <div className="card-bg-overlay explorer-bg"></div>
              <Compass size={32} className="card-icon" />
              <span className="card-title">History Explorer</span>
            </button>
          </div>
        </div>
      )}

      {/* Mobile Back Button (Only visible on mobile when not home) */}
      {mobileScreen !== null && mobileScreen !== 'home' && (
        <button 
          className="mobile-back-btn"
          onClick={() => {
            if (window.history.state && window.history.state.screen) {
              window.history.back();
            } else {
              setMobileScreen('home');
            }
          }}
          title="Back to Home Dashboard"
        >
          <Home size={18} />
        </button>
      )}

      {/* Mobile Collapse Toggle (Only shows when sidebar is hidden) */}
      {mobileCollapsed && (
        <button 
          className="mobile-toggle-btn"
          onClick={() => setMobileCollapsed(false)}
        >
          <Menu size={24} />
        </button>
      )}

      {/* Glassmorphic Sidebar Dashboard */}
      <aside className={`sidebar-pane ${mobileCollapsed ? 'is-collapsed' : ''}`}>
        
        {/* Mobile handle indicator */}
        <div className="mobile-drawer-handle" onClick={() => setMobileCollapsed(!mobileCollapsed)}></div>
        
        <header className="sidebar-header">
          <div className="brand-wrapper">
            <Compass className="brand-logo" size={32} />
            <h1 className="brand-name">LankaRoute</h1>
          </div>
          <span className="brand-tagline">Sri Lanka Trip Planner & Route Optimizer</span>
          <button 
            className="mobile-close-btn"
            onClick={() => setMobileCollapsed(true)}
            title="Close Menu"
          >
            <X size={24} />
          </button>
        </header>

        {/* Tab Switcher Buttons */}
        <div className="tab-navigation">
          <button 
            className={`nav-tab-btn ${activeTab === 'planner' ? 'active' : ''}`}
            onClick={() => setActiveTab('planner')}
          >
            🗺️ Trip Planner
          </button>
          <button 
            className={`nav-tab-btn ${activeTab === 'explorer' ? 'active' : ''}`}
            onClick={() => setActiveTab('explorer')}
          >
            📖 History Explorer
          </button>
        </div>

        <div className="sidebar-body">
          {activeTab === 'planner' ? (
            <>
              {/* Geocoding Search bar */}
              <div className="search-container">
                <div className="search-input-wrapper">
                  <Search className="search-icon" size={18} />
                  <input 
                    type="text"
                    className="search-input"
                    placeholder="Search historic stupas, parks, falls, hotels..."
                    value={searchQuery}
                    onChange={handleSearchChange}
                    style={{ paddingRight: '46px' }}
                  />
                  {/* GPS Manual Trigger Button inside search bar */}
                  <button 
                    className={`btn-card-action btn-lock ${gpsLoading ? 'animate-pulse' : ''}`}
                    style={{ 
                      position: 'absolute', 
                      right: '8px', 
                      padding: '8px', 
                      background: 'rgba(6, 182, 212, 0.15)', 
                      border: '1px solid rgba(6, 182, 212, 0.3)', 
                      color: 'var(--primary)',
                      boxShadow: '0 0 8px rgba(6, 182, 212, 0.2)'
                    }}
                    onClick={() => triggerGPSLocation(false)}
                    title="Locate My Current Device Location"
                    disabled={gpsLoading}
                  >
                    <Locate size={16} />
                  </button>
                </div>
                {/* Auto suggestions lists (gmaps styled parsing) */}
                {suggestions.length > 0 && (
                  <ul className="suggestions-list">
                    {suggestions.map((item, idx) => {
                      return (
                        <li 
                          key={idx} 
                          className="suggestion-item"
                          onClick={() => addWaypointFromSuggestion(item)}
                        >
                          <strong style={{ color: '#06b6d4' }}>{item.name}</strong>
                          <span style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>{item.subtitle}</span>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {isSearching && (
                  <div className="suggestions-list" style={{ padding: '16px', textAlign: 'center', color: '#94a3b8', fontSize: '13px' }}>
                    Searching Sri Lankan directories...
                  </div>
                )}
              </div>

              {/* Rapid Hotspots addition */}
              <div>
                <h3 className="section-title">Popular Hubs Quick Add</h3>
                <div className="hotspots-grid">
                  {SRI_LANKA_HOTSPOTS.map((hotspot, idx) => (
                    <button 
                      key={idx}
                      className="hotspot-chip"
                      onClick={() => addHotspot(hotspot)}
                    >
                      <MapPin size={12} className="color-highlight" />
                      {hotspot.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Active Itinerary List Timeline */}
              <div className="waypoints-list-container">
                <h3 className="section-title">Your Itinerary Timeline</h3>
                
                {waypoints.length === 0 ? (
                  <div className="waypoints-empty">
                    <Compass size={32} className="color-highlight" style={{ opacity: 0.6 }} />
                    <p>No locations added yet.</p>
                    <p style={{ fontSize: '11px', color: '#64748b' }}>Search above, click popular hubs, or tap directly on the map to add custom trip stops!</p>
                  </div>
                ) : (
                  <div className="waypoints-timeline">
                    {activeWaypoints.map((wp, index) => {
                      const originalIndex = waypoints.findIndex(w => w.id === wp.id);
                      let isStart = index === 0;
                      let isEnd = wp.isEnd;
                      let isBase = wp.isLocked && index > 0 && !isEnd;
                      
                      let cardClass = isStart ? 'is-start' : isEnd ? 'is-end' : isBase ? 'is-base' : 'is-stop';
                      let badgeClass = isStart ? 'bg-start' : isEnd ? 'bg-end' : isBase ? 'bg-base' : 'bg-stop';
                      let badgeLabel = isStart ? 'S' : isEnd ? 'E' : isBase ? 'B' : (index + 1).toString();

                      return (
                        <div key={wp.id} className={`waypoint-card ${cardClass}`}>
                          <div className={`waypoint-badge ${badgeClass}`}>
                            {badgeLabel}
                          </div>

                          <div className="waypoint-details">
                            <div className="waypoint-title" title={wp.name}>
                              {wp.name}
                            </div>
                            <div className="waypoint-coords">
                              {wp.lat.toFixed(4)}, {wp.lng.toFixed(4)}
                            </div>
                          </div>

                          <div className="waypoint-actions">
                            {/* Lock Button (for hotel/base camp positioning) */}
                            <button 
                              className={`btn-card-action btn-lock ${wp.isLocked ? 'is-locked' : ''}`}
                              onClick={() => toggleLockWaypoint(wp.id)}
                              title={isStart ? 'Starting point is locked' : wp.isEnd ? 'End point is locked' : wp.isLocked ? 'Unlock Position' : 'Lock Position here'}
                              disabled={isStart || wp.isEnd}
                            >
                              {wp.isLocked ? <Lock size={14} /> : <Unlock size={14} />}
                            </button>

                            {/* Set End Point Button */}
                            {!isStart && !isRoundTrip && (
                              <button 
                                className={`btn-card-action ${wp.isEnd ? 'is-active' : ''}`}
                                onClick={() => handleSetEndWaypoint(wp.id)}
                                title={wp.isEnd ? 'Remove as End Point' : 'Set as End Point'}
                                style={{
                                  color: wp.isEnd ? '#ef4444' : '#64748b',
                                  background: wp.isEnd ? 'rgba(239, 68, 68, 0.15)' : 'transparent',
                                  border: wp.isEnd ? '1px solid rgba(239, 68, 68, 0.3)' : 'none',
                                  borderRadius: '4px',
                                  padding: '2px'
                                }}
                              >
                                <Flag size={14} />
                              </button>
                            )}

                            {/* Move Up */}
                            <button 
                              className="btn-card-action"
                              onClick={() => moveWaypoint(originalIndex, -1)}
                              disabled={originalIndex === 0 || wp.isEnd || isAutoOptimize}
                              title={isAutoOptimize ? "Disable Auto-Sort to move manually" : "Move Up"}
                            >
                              <ChevronUp size={14} />
                            </button>

                            {/* Move Down */}
                            <button 
                              className="btn-card-action"
                              onClick={() => moveWaypoint(originalIndex, 1)}
                              disabled={originalIndex === waypoints.length - 1 || (originalIndex === waypoints.length - 2 && waypoints[waypoints.length - 1].isEnd) || isAutoOptimize}
                              title={isAutoOptimize ? "Disable Auto-Sort to move manually" : "Move Down"}
                            >
                              <ChevronDown size={14} />
                            </button>

                            {/* Delete */}
                            <button 
                              className="btn-card-action btn-delete"
                              onClick={() => deleteWaypoint(wp.id)}
                              title="Delete Stop"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Trip Budget Estimator Panel */}
              {totalDistance > 0 && (
                <div className="budget-estimator-card" style={{
                  background: 'rgba(15, 23, 42, 0.4)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '16px',
                  padding: '14px 16px',
                  marginTop: '16px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px'
                }}>
                  <h3 className="section-title" style={{ fontSize: '11px', display: 'flex', alignItems: 'center', gap: '6px', margin: 0 }}>
                    <span>💰 Trip Budget Estimator / වියදම් ගණකය</span>
                  </h3>
                  
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                    {/* Rate per Km */}
                    <div>
                      <label style={{ fontSize: '10px', color: '#94a3b8', display: 'block', marginBottom: '4px' }}>
                        Rate per Km / කි.මී. මිල (LKR)
                      </label>
                      <input
                        type="number"
                        value={ratePerKm}
                        onChange={(e) => setRatePerKm(Math.max(0, Number(e.target.value)))}
                        style={{
                          width: '100%',
                          background: 'rgba(0,0,0,0.25)',
                          border: '1px solid var(--border-color)',
                          color: '#fff',
                          borderRadius: '6px',
                          padding: '5px 8px',
                          fontSize: '12px'
                        }}
                      />
                    </div>
                    
                    {/* Auto Distance */}
                    <div>
                      <label style={{ fontSize: '10px', color: '#94a3b8', display: 'block', marginBottom: '4px' }}>
                        Total Distance / මුළු දුර
                      </label>
                      <div style={{
                        padding: '5px 8px',
                        background: 'rgba(255,255,255,0.05)',
                        border: '1px solid rgba(255,255,255,0.05)',
                        color: 'var(--primary)',
                        borderRadius: '6px',
                        fontSize: '12px',
                        fontWeight: 'bold'
                      }}>
                        {totalDistance.toFixed(1)} km
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                    {/* Auto Vehicle Cost */}
                    <div>
                      <label style={{ fontSize: '10px', color: '#94a3b8', display: 'block', marginBottom: '4px' }}>
                        Vehicle Cost / වාහන කුලිය
                      </label>
                      <div style={{
                        padding: '5px 8px',
                        background: 'rgba(6, 182, 212, 0.08)',
                        border: '1px solid rgba(6, 182, 212, 0.2)',
                        borderRadius: '6px',
                        fontSize: '12px',
                        fontWeight: '700',
                        color: 'var(--primary)'
                      }}>
                        LKR {vehicleCost.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                      </div>
                    </div>

                    {/* Accomodation Cost */}
                    <div>
                      <label style={{ fontSize: '10px', color: '#94a3b8', display: 'block', marginBottom: '4px' }}>
                        Stay / නවාතැන් (LKR)
                      </label>
                      <input
                        type="number"
                        placeholder="LKR 0"
                        value={accommodationCost || ''}
                        onChange={(e) => setAccommodationCost(Math.max(0, Number(e.target.value)))}
                        style={{
                          width: '100%',
                          background: 'rgba(0,0,0,0.25)',
                          border: '1px solid var(--border-color)',
                          color: '#fff',
                          borderRadius: '6px',
                          padding: '5px 8px',
                          fontSize: '12px'
                        }}
                      />
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                    {/* Food Cost */}
                    <div>
                      <label style={{ fontSize: '10px', color: '#94a3b8', display: 'block', marginBottom: '4px' }}>
                        Food & Tickets / ආහාර (LKR)
                      </label>
                      <input
                        type="number"
                        placeholder="LKR 0"
                        value={foodCost || ''}
                        onChange={(e) => setFoodCost(Math.max(0, Number(e.target.value)))}
                        style={{
                          width: '100%',
                          background: 'rgba(0,0,0,0.25)',
                          border: '1px solid var(--border-color)',
                          color: '#fff',
                          borderRadius: '6px',
                          padding: '5px 8px',
                          fontSize: '12px'
                        }}
                      />
                    </div>

                    {/* Other Cost */}
                    <div>
                      <label style={{ fontSize: '10px', color: '#94a3b8', display: 'block', marginBottom: '4px' }}>
                        Other Expenses / වෙනත් (LKR)
                      </label>
                      <input
                        type="number"
                        placeholder="LKR 0"
                        value={otherCost || ''}
                        onChange={(e) => setOtherCost(Math.max(0, Number(e.target.value)))}
                        style={{
                          width: '100%',
                          background: 'rgba(0,0,0,0.25)',
                          border: '1px solid var(--border-color)',
                          color: '#fff',
                          borderRadius: '6px',
                          padding: '5px 8px',
                          fontSize: '12px'
                        }}
                      />
                    </div>
                  </div>

                  <hr style={{ border: 'none', borderTop: '1px dashed rgba(255,255,255,0.05)', margin: '4px 0' }} />

                  <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: '10px', alignItems: 'center' }}>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span style={{ fontSize: '11px', fontWeight: 'bold', color: '#cbd5e1' }}>Total Trip Cost / මුළු වියදම</span>
                      <span style={{ fontSize: '18px', fontWeight: '800', color: '#10b981', marginTop: '2px' }}>
                        LKR {totalTripCost.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                      </span>
                    </div>
                    
                    <div>
                      <label style={{ fontSize: '10px', color: '#94a3b8', display: 'block', marginBottom: '4px' }}>
                        Travelers / සාමාජිකයින්
                      </label>
                      <input
                        type="number"
                        value={numTravelers}
                        onChange={(e) => setNumTravelers(Math.max(1, Number(e.target.value)))}
                        style={{
                          width: '100%',
                          background: 'rgba(0,0,0,0.25)',
                          border: '1px solid var(--border-color)',
                          color: '#fff',
                          borderRadius: '6px',
                          padding: '5px 8px',
                          fontSize: '12px',
                          fontWeight: 'bold',
                          textAlign: 'center'
                        }}
                      />
                    </div>
                  </div>

                  {numTravelers > 1 && (
                    <div style={{
                      padding: '8px 12px',
                      background: 'rgba(16, 185, 129, 0.08)',
                      border: '1px solid rgba(16, 185, 129, 0.2)',
                      borderRadius: '8px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginTop: '4px'
                    }}>
                      <span style={{ fontSize: '11px', fontWeight: '600', color: '#cbd5e1' }}>Per Person / එක් අයෙකුට:</span>
                      <span style={{ fontSize: '13px', fontWeight: '700', color: '#10b981' }}>
                        LKR {costPerPerson.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Vehicle Mode Selector */}
              <div className="vehicle-selector-container" style={{ marginTop: '16px', borderTop: '1px dashed var(--border-color)', paddingTop: '16px' }}>
                <h3 className="section-title" style={{ marginBottom: '8px', fontSize: '11px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>Select Travel Vehicle / වාහනය තෝරන්න</span>
                  <span style={{ fontSize: '9px', color: 'var(--primary)', background: 'rgba(6, 182, 212, 0.1)', padding: '2px 6px', borderRadius: '4px', border: '1px solid rgba(6, 182, 212, 0.2)' }}>
                    {profile.speedLimitLabel}
                  </span>
                </h3>
                <div className="vehicle-chips-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(72px, 1fr))', gap: '6px' }}>
                  {Object.entries(VEHICLE_PROFILES).map(([key, prof]) => {
                    const isSelected = selectedVehicle === key;
                    return (
                      <button
                        key={key}
                        type="button"
                        className={`vehicle-chip ${isSelected ? 'is-active' : ''}`}
                        onClick={() => setSelectedVehicle(key)}
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          padding: '8px 4px',
                          borderRadius: '8px',
                          border: isSelected ? '1px solid var(--primary)' : '1px solid rgba(255,255,255,0.05)',
                          background: isSelected ? 'rgba(6, 182, 212, 0.15)' : 'rgba(255,255,255,0.02)',
                          color: isSelected ? 'var(--primary)' : '#94a3b8',
                          cursor: 'pointer',
                          transition: 'all 0.2s ease',
                          boxShadow: isSelected ? '0 0 10px rgba(6, 182, 212, 0.2)' : 'none'
                        }}
                        title={prof.label + ': ' + prof.speedLimitLabel}
                      >
                        <span style={{ fontSize: '18px', marginBottom: '4px' }}>{prof.icon}</span>
                        <span style={{ fontSize: '9px', fontWeight: '500', whiteSpace: 'nowrap' }}>{prof.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Route Options Selection Panel */}
              {routeOptions.length > 1 && (
                <div className="route-options-container" style={{ marginTop: '8px', maxHeight: '150px', overflowY: 'auto', paddingRight: '4px' }}>
                  <h3 className="section-title" style={{ marginBottom: '8px', fontSize: '11px' }}>
                    🛣️ Select Route Alternative / මාර්ග තෝරන්න
                  </h3>
                  <div className="route-options-list" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {routeOptions.map((route, index) => {
                      const isSelected = index === selectedRouteIndex;
                      const isShortest = index === shortestRouteIndex;
                      const isFastest = index === fastestRouteIndex;

                      return (
                        <button
                          key={index}
                          type="button"
                          className={`route-option-card ${isSelected ? 'is-active' : ''}`}
                          onClick={() => setSelectedRouteIndex(index)}
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            width: '100%',
                            padding: '8px 10px',
                            borderRadius: '8px',
                            border: isSelected ? '1px solid var(--primary)' : '1px solid rgba(255,255,255,0.05)',
                            background: isSelected ? 'rgba(6, 182, 212, 0.08)' : 'rgba(255,255,255,0.01)',
                            color: isSelected ? '#fff' : '#94a3b8',
                            cursor: 'pointer',
                            textAlign: 'left',
                            transition: 'all 0.2s ease',
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', marginBottom: '2px', alignItems: 'center' }}>
                            <span style={{ fontSize: '11px', fontWeight: '600', color: isSelected ? 'var(--primary)' : '#cbd5e1', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                              Option {index + 1}: {index === 0 ? '🚀 Best Optimized' : `Alternative ${index}`}
                              {isShortest && (
                                <span style={{ fontSize: '9px', background: 'rgba(16, 185, 129, 0.2)', border: '1px solid rgba(16, 185, 129, 0.3)', color: '#10b981', padding: '1px 4px', borderRadius: '4px' }} title="Shortest route by distance / කෙටිම මාර්ගය">
                                  Shortest / කෙටිම
                                </span>
                              )}
                              {isFastest && !isShortest && (
                                <span style={{ fontSize: '9px', background: 'rgba(245, 158, 11, 0.2)', border: '1px solid rgba(245, 158, 11, 0.3)', color: '#f59e0b', padding: '1px 4px', borderRadius: '4px' }} title="Fastest route by duration / වේගවත්ම මාර්ගය">
                                  Fastest / වේගවත්ම
                                </span>
                              )}
                            </span>
                            <span style={{ fontSize: '11px', fontWeight: '700', color: isSelected ? 'var(--primary)' : '#e2e8f0' }}>
                              {formatDuration(route.durationHrs * profile.speedFactor)}
                            </span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', fontSize: '10px', color: '#64748b' }}>
                            <span style={{ maxWidth: '65%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              via {route.summary || 'Secondary Roads'}
                            </span>
                            <span style={{ color: isSelected ? '#a5f3fc' : '#94a3b8', fontWeight: '500' }}>
                              {route.distanceKm.toFixed(1)} km
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Route Stats Panel */}
              {totalDistance > 0 && (
                <div className="stats-container" style={{ marginTop: '8px' }}>
                  <h3 className="section-title" style={{ marginBottom: '4px', fontSize: '11px' }}>
                    <Activity size={12} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
                    Route Summary ({profile.icon} {profile.label})
                  </h3>
                  <div className="stats-grid">
                    <div className="stat-item">
                      <span className="stat-label">Driving Distance</span>
                      <span className="stat-val color-highlight">
                        {totalDistance.toFixed(1)} km
                      </span>
                    </div>
                    <div className="stat-item">
                      <span className="stat-label">Estimated Time</span>
                      <span className="stat-val">
                        {formatDuration(totalDuration)}
                      </span>
                    </div>
                  </div>
                  
                  {isFallbackRoute ? (
                    <div className="stats-info-msg">
                      <HelpCircle size={10} />
                      Offline direct flight routing mode fallback active
                    </div>
                  ) : (
                    <div className="stats-info-msg" style={{ color: '#10b981' }}>
                      <CheckCircle2 size={10} />
                      {!profile.allowsExpressway ? 'Bypassing expressways for slow vehicle' : 'Real driving road routes solved via Sri Lanka matrix'}
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            <>
              {/* History Explorer Search Container */}
              <div className="search-container">
                
                
                <div className="search-input-wrapper">
                  <Search className="search-icon" size={18} />
                  <input 
                    type="text"
                    className="search-input"
                    placeholder="Search any place in Sri Lanka..."
                    value={wikiSearchQuery}
                    onChange={handleWikiSearchChange}
                  />
                </div>
                
                {/* Wiki Suggestions dropdown */}
                {wikiSuggestions.length > 0 && (
                  <ul className="suggestions-list">
                    {wikiSuggestions.map((item, idx) => (
                      <li 
                        key={idx} 
                        className="suggestion-item"
                        onClick={() => loadWikiArticle(item)}
                      >
                        <strong style={{ color: '#06b6d4' }}>{item.title}</strong>
                        <span style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                          {item.snippet}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {wikiLoading && !wikiArticle && (
                  <div className="suggestions-list" style={{ padding: '16px', textAlign: 'center', color: '#94a3b8', fontSize: '13px' }}>
                    Searching Sri Lanka map...
                  </div>
                )}
              </div>

              {/* Popular Historical Sites list */}
              <div>
                <h3 className="section-title">Explore Heritage Hubs</h3>
                <div className="hotspots-grid">
                  {POPULAR_HISTORICAL_SITES.map((site, idx) => (
                    <button 
                      key={idx}
                      className="hotspot-chip"
                      onClick={() => loadWikiArticle(site.wikiTitle)}
                      style={{ border: '1px solid rgba(6, 182, 212, 0.15)', background: 'rgba(6, 182, 212, 0.02)' }}
                    >
                      📖 {site.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* If an article is loaded, show summary card inside sidebar */}
              {wikiArticle && (
                <div className="wiki-sidebar-summary-card" style={{
                  marginTop: '16px',
                  background: 'rgba(15, 23, 42, 0.4)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '16px',
                  padding: '16px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px'
                }}>
                  <h4 style={{ color: 'var(--primary)', fontFamily: 'var(--font-heading)', fontSize: '11px', margin: 0, fontWeight: '700', letterSpacing: '0.5px' }}>
                    {wikiLanguage === 'si' ? 'දැනට කියවන්නේ' : 'CURRENTLY READING'}
                  </h4>
                  <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                    {wikiArticle.mainImage && (
                      <img 
                        src={wikiArticle.mainImage} 
                        alt={wikiLanguage === 'si' && wikiArticle.si ? wikiArticle.si.title : wikiArticle.en.title} 
                        style={{ width: '50px', height: '50px', borderRadius: '8px', objectFit: 'cover', border: '1px solid var(--border-color)' }}
                      />
                    )}
                    <div>
                      <h5 style={{ color: '#fff', fontSize: '13px', fontWeight: 'bold', margin: '0 0 2px 0' }}>
                        {wikiLanguage === 'si' && wikiArticle.si ? wikiArticle.si.title : wikiArticle.en.title}
                      </h5>
                      <span style={{ fontSize: '10px', color: '#94a3b8' }}>
                        {wikiLanguage === 'si' ? 'ඉදිකළ යුගය' : 'Built'}: {wikiLanguage === 'si' && wikiArticle.si ? wikiArticle.si.stats.era : wikiArticle.en.stats.era}
                      </span>
                    </div>
                  </div>
                  <button
                    className="popup-btn"
                    style={{
                      background: 'rgba(255, 255, 255, 0.05)',
                      border: '1px solid var(--border-color)',
                      color: '#fff',
                      fontSize: '11px',
                      padding: '8px 12px',
                      borderRadius: '8px',
                      cursor: 'pointer'
                    }}
                    onClick={() => {
                      const reader = document.querySelector('.wiki-reader-page');
                      if (reader) reader.scrollTo({ top: 0, behavior: 'smooth' });
                    }}
                  >
                    {wikiLanguage === 'si' ? 'විස්තර බලන්න' : 'View Full History'}
                  </button>
                  <button 
                    className="popup-btn popup-btn-add" 
                    onClick={addWikiPlaceToItinerary}
                  >
                    {wikiLanguage === 'si' ? '🗺️ ගමනට එක් කරන්න' : '🗺️ Add to Trip Itinerary'}
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {/* Sidebar Footer */}
        <footer className="sidebar-footer">
          {activeTab === 'planner' && (
            <>
              {/* Route controls */}
              <div className="controls-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div className="toggle-wrapper" style={{ padding: '10px' }}>
                  <span className="toggle-label" style={{ fontSize: '11px', gap: '6px' }}>
                    <RotateCcw size={13} />
                    Round Trip
                  </span>
                  <label className="toggle-switch">
                    <input 
                      type="checkbox"
                      checked={isRoundTrip}
                      onChange={(e) => {
                        setIsRoundTrip(e.target.checked);
                        resetOptimization();
                      }}
                    />
                    <span className="toggle-slider"></span>
                  </label>
                </div>

                <div className="toggle-wrapper" style={{ padding: '10px' }}>
                  <span className="toggle-label" style={{ fontSize: '11px', gap: '6px' }}>
                    <Sparkles size={13} className="color-highlight" />
                    Auto-Sort
                  </span>
                  <label className="toggle-switch">
                    <input 
                      type="checkbox"
                      checked={isAutoOptimize}
                      onChange={(e) => {
                        setIsAutoOptimize(e.target.checked);
                      }}
                    />
                    <span className="toggle-slider"></span>
                  </label>
                </div>
              </div>

              <div style={{ display: 'flex', width: '100%', marginTop: '-6px' }}>
                <button 
                  className="btn-clear"
                  onClick={clearItinerary}
                  disabled={waypoints.length === 0}
                  style={{ width: '100%', padding: '10px', borderRadius: '12px', fontSize: '12px' }}
                >
                  Clear All Stops / සියල්ල මකන්න
                </button>
              </div>

              <button 
                className="btn-optimize"
                onClick={() => {
                  if (!isAutoOptimize) {
                    setIsAutoOptimize(true);
                  } else {
                    handleOptimize();
                  }
                }}
                disabled={waypoints.length < 2 || isOptimizing}
                style={{
                  background: isAutoOptimize 
                    ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)' 
                    : 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
                  color: '#fff',
                  boxShadow: isAutoOptimize 
                    ? '0 4px 15px rgba(16, 185, 129, 0.3)' 
                    : '0 4px 15px rgba(99, 102, 241, 0.3)'
                }}
              >
                {isOptimizing ? (
                  <>Calculating Roads...</>
                ) : isAutoOptimize ? (
                  <>
                    <Sparkles size={16} />
                    Auto-Sort: Shortest Path Active
                  </>
                ) : (
                  <>
                    <Navigation size={16} />
                    Manual Order: Switch to Auto-Sort
                  </>
                )}
              </button>
            </>
          )}

          {/* Designed and Created Branded Footer - ALWAYS PRESERVED */}
          <div className="designed-footer">
            Designed & Created by <a href="#" target="_blank" rel="noopener noreferrer">Imal Wickrama Arachchi</a>
          </div>
        </footer>
      </aside>

      {/* Dynamic Leaflet Map Component container */}
      <main className={`map-wrapper ${activeTab === 'explorer' ? 'hide-map' : ''}`}>
        
        

        {/* Floating Map Theme Toggle Button */}
        <button 
          className="map-theme-toggle-icon-only"
          onClick={() => setMapTheme(prev => prev === 'dark' ? 'light' : 'dark')}
          title={mapTheme === 'dark' ? 'Switch to Google Maps Light Style / මැප් ස්ටයිල් එකට මාරු කරන්න' : 'Switch to Dark Mode / ඩාර්ක් මෝඩ් එකට මාරු කරන්න'}
        >
          {mapTheme === 'dark' ? <Sun size={18} className="theme-toggle-icon sun" /> : <Moon size={18} className="theme-toggle-icon moon" />}
        </button>

        <div id="map-container"></div>
        <div className="map-instructions">
          <MapPin size={12} className="color-highlight" />
          <span>💡 Tap anywhere inside Sri Lanka on the map to place a custom pin instantly!</span>
        </div>
      </main>

      {/* Historical Place Article Reader Page */}
      {activeTab === 'explorer' && wikiArticle && (
        <main className="wiki-reader-page">
          <div className={`wiki-reader-content ${wikiLanguage === 'si' && wikiArticle.si ? 'lang-si' : 'lang-en'}`}>
            
            {/* Header: Title, Language switcher, and Close button */}
            <div className="wiki-reader-header">
              <div className="wiki-reader-header-left">
                <h2 className="wiki-title">
                  {wikiLanguage === 'si' && wikiArticle.si ? wikiArticle.si.title : wikiArticle.en.title}
                </h2>
              </div>
              <div className="wiki-reader-header-actions">
                <div className="wiki-lang-switcher">
                  <button 
                    type="button"
                    className={`lang-btn ${wikiLanguage === 'en' ? 'active' : ''}`}
                    onClick={() => {
                      setWikiLanguage('en');
                      handleSpeechStop();
                    }}
                  >
                    EN
                  </button>
                  <button 
                    type="button"
                    className={`lang-btn ${wikiLanguage === 'si' ? 'active' : ''}`}
                    onClick={() => {
                      if (wikiArticle.si) {
                        setWikiLanguage('si');
                        handleSpeechStop();
                      } else {
                        alert('මෙම ස්ථානය සඳහා සිංහල විස්තර විකිපීඩියා හි තවමත් ඇතුළත් කර නොමැත. / Sinhala details are not yet available on Wikipedia for this site.');
                      }
                    }}
                    disabled={!wikiArticle.si}
                    title={!wikiArticle.si ? 'සිංහල විස්තර නොමැත / Sinhala description unavailable' : 'සිංහලෙන් කියවන්න / Read in Sinhala'}
                    style={{ opacity: !wikiArticle.si ? 0.4 : 1 }}
                  >
                    සිංහල
                  </button>
                </div>
                
                <button 
                  className="wiki-close-btn"
                  onClick={handleSpeechToggle}
                  title={wikiLanguage === 'si' ? 'කියවීම අරඹන්න / නවතන්න' : 'Play/Pause AI Voice Guide'}
                  style={{
                    background: isSpeaking && !speechPaused ? 'rgba(16, 185, 129, 0.2)' : 'rgba(255, 255, 255, 0.1)',
                    color: isSpeaking && !speechPaused ? '#10b981' : '#fff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginRight: '8px',
                    borderRadius: '50%',
                    width: '36px',
                    height: '36px',
                    border: 'none',
                    cursor: 'pointer'
                  }}
                >
                  {isSpeaking && !speechPaused ? <Volume2 size={18} /> : <VolumeX size={18} />}
                </button>
                <button 
                  className="wiki-close-btn"
                  onClick={() => {
                    handleSpeechStop();
                    setWikiArticle(null);
                  }}
                  title={wikiLanguage === 'si' ? 'සිතියම වෙත' : 'Back to Map'}
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Quick Stats Panel */}
            <div className="wiki-stats-grid">
              {((wikiLanguage === 'si' && wikiArticle.si?.stats?.builder) || (wikiLanguage === 'en' && wikiArticle.en?.stats?.builder)) && (
                <div className="wiki-stat-card">
                  <span className="wiki-stat-label">
                    {wikiLanguage === 'si' ? 'ඉදිකිරීම්කරු / නිර්මාතෘ' : 'Builder / Creator'}
                  </span>
                  <span className="wiki-stat-val">
                    {wikiLanguage === 'si' && wikiArticle.si ? wikiArticle.si.stats.builder : wikiArticle.en.stats.builder}
                  </span>
                </div>
              )}
              {((wikiLanguage === 'si' && wikiArticle.si?.stats?.era) || (wikiLanguage === 'en' && wikiArticle.en?.stats?.era)) && (
                <div className="wiki-stat-card">
                  <span className="wiki-stat-label">
                    {wikiLanguage === 'si' ? 'යුගය / කාලසීමාව' : 'Era / Timeframe'}
                  </span>
                  <span className="wiki-stat-val">
                    {wikiLanguage === 'si' && wikiArticle.si ? wikiArticle.si.stats.era : wikiArticle.en.stats.era}
                  </span>
                </div>
              )}
              {wikiArticle.coordinates && (
                <div className="wiki-stat-card">
                  <span className="wiki-stat-label">
                    {wikiLanguage === 'si' ? 'පිහිටීම' : 'Location'}
                  </span>
                  <span className="wiki-stat-val">
                    {wikiArticle.coordinates.lat.toFixed(4)}°N, {wikiArticle.coordinates.lon.toFixed(4)}°E
                  </span>
                </div>
              )}
            </div>

            {/* Wikimedia Gallery Carousel */}
            {wikiArticle.images.length > 0 && (
              <div className="wiki-carousel-wrapper">
                <div className="wiki-carousel-main">
                  <img 
                    src={wikiArticle.images[activeWikiImageIndex]} 
                    alt={`${wikiLanguage === 'si' && wikiArticle.si ? wikiArticle.si.title : wikiArticle.en.title} - Image ${activeWikiImageIndex + 1}`}
                    className="wiki-carousel-img"
                  />
                  
                  {wikiArticle.images.length > 1 && (
                    <>
                      <button 
                        className="wiki-carousel-nav prev"
                        onClick={() => setActiveWikiImageIndex(prev => prev === 0 ? wikiArticle.images.length - 1 : prev - 1)}
                      >
                        ‹
                      </button>
                      <button 
                        className="wiki-carousel-nav next"
                        onClick={() => setActiveWikiImageIndex(prev => prev === wikiArticle.images.length - 1 ? 0 : prev + 1)}
                      >
                        ›
                      </button>
                    </>
                  )}
                </div>
                
                {/* Dots indicator */}
                {wikiArticle.images.length > 1 && (
                  <div className="wiki-carousel-dots">
                    {wikiArticle.images.map((_, idx) => (
                      <span 
                        key={idx} 
                        className={`wiki-dot ${idx === activeWikiImageIndex ? 'active' : ''}`}
                        onClick={() => setActiveWikiImageIndex(idx)}
                      ></span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Action Bridge Button */}
            <div className="wiki-action-bridge-container">
              <button 
                className="btn-optimize wiki-bridge-btn"
                onClick={addWikiPlaceToItinerary}
                style={{
                  background: 'linear-gradient(135deg, #06b6d4 0%, #0891b2 100%)',
                  boxShadow: '0 4px 15px rgba(6, 182, 212, 0.4)',
                  padding: '12px 24px',
                  borderRadius: '12px',
                  width: 'auto',
                  margin: '0 auto',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}
              >
                <Sparkles size={16} />
                {wikiLanguage === 'si' ? 'ගමනට එක් කරන්න' : 'Add to Trip Itinerary'}
              </button>
            </div>

            {/* Expandable Sections / Accordion */}
            <div className="wiki-sections-container">
              {(wikiLanguage === 'si' && wikiArticle.si ? wikiArticle.si.sections : wikiArticle.en.sections).map((section, idx) => (
                <div key={idx} className="wiki-section-card">
                  <h3 className="wiki-section-title">{section.title}</h3>
                  <div className="wiki-section-content">
                    {section.content.split('\n').map((paragraph, pIdx) => {
                      if (!paragraph.trim()) return null;
                      return <p key={pIdx} className="wiki-paragraph">{paragraph}</p>;
                    })}
                  </div>
                </div>
              ))}
            </div>

          </div>
        </main>
      )}
      {(mobileScreen === null || mobileScreen === 'home') && <Chatbot />}
    </div>
  );
}