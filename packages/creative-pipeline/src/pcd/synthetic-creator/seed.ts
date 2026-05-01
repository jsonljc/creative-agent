// PCD slice SP11 — synthetic creator seed roster (Phase 1 + 2, 10 creators).
// Source-of-truth: persona doc shared on 2026-04-30 (Switchboard Internal,
// Phase 1+2 Persona Library). Every dallePromptLocked, descriptor, and
// sample hook is copied verbatim from that doc.
import type { CreatorIdentitySyntheticPayload } from "@creativeagent/schemas";

interface CreatorIdentityStub {
  id: string;
  name: string;
  kind: "synthetic";
}

interface RosterEntry {
  creatorIdentity: CreatorIdentityStub;
  synthetic: CreatorIdentitySyntheticPayload;
}

const cheryl: RosterEntry = {
  creatorIdentity: { id: "cid_synth_cheryl_sg_01", name: "Cheryl", kind: "synthetic" },
  synthetic: {
    creatorIdentityId: "cid_synth_cheryl_sg_01",
    treatmentClass: "med_spa",
    vibe: "omg_look",
    market: "SG",
    ethnicityFamily: "sg_chinese",
    ageBand: "mid_20s",
    pricePositioning: "entry",
    physicalDescriptors: {
      faceShape: "Heart-shaped, pointed chin, slightly wide forehead",
      skinTone: "Light-medium, cool-neutral undertone, NC20-NC25",
      eyeShape: "Double eyelid, slightly upturned outer corners, bright and wide",
      hair: "Black, messy half-bun with flyaways, like she just threw it up",
      ageRead: "Looks 21-23, baby-faced",
      buildNote: "Petite, slim shoulders, slight collarbone visible",
    },
    dallePromptLocked:
      "Vertical lo-fi selfie photo. Young Chinese Singaporean woman, 23 years old, heart-shaped face with pointed chin and slightly wide forehead, light-medium cool-neutral skin tone NC20-NC25, bright wide double-eyelid eyes slightly upturned at outer corners, black hair in a messy half-bun with flyaways, petite slim shoulders. She is in a clinic bathroom, filming herself in the mirror, phone visible in frame, chaotic excited expression — mouth slightly open like she just gasped. She has a slight flush on her cheeks and a subtle sheen on her skin indicating she just had a treatment. Wearing a clinic wristband on one wrist. Casual clothes, nothing styled. Top 25-30% of frame is open breathing room for text overlay. iPhone front camera quality, no colour grading, slight grain, natural fluorescent bathroom lighting. Not professional photography. Real camera roll aesthetic.",
    klingDirection: {
      setting: "Clinic bathroom mirror, phone visibly in hand",
      motion: "Sudden lean into camera, then pull back excitedly",
      energy: "Mouth opening mid-sentence, gesturing with free hand",
      lighting: "Unflattering fluorescent — keep it real",
      avoid: ["Slow pans", "Beauty lighting", "Transitions", "Music sync"],
    },
    voiceCaptionStyle: {
      voice: "Fast, rising intonation, slight breathiness",
      captionStyle: 'ALL CAPS moments, lots of ellipses, "okay but"',
      sampleHook: "okay but why did nobody tell me how good this would feel",
      sampleCta: "just go. seriously. just book it.",
    },
    mutuallyExclusiveWithIds: [],
    status: "active",
  },
};

const vivienne: RosterEntry = {
  creatorIdentity: { id: "cid_synth_vivienne_sg_02", name: "Vivienne", kind: "synthetic" },
  synthetic: {
    creatorIdentityId: "cid_synth_vivienne_sg_02",
    treatmentClass: "med_spa",
    vibe: "quiet_confidence",
    market: "SG",
    ethnicityFamily: "sg_chinese",
    ageBand: "mid_20s",
    pricePositioning: "standard",
    physicalDescriptors: {
      faceShape: "Oval, symmetrical, refined",
      skinTone: "Fair, neutral-cool undertone, NC15",
      eyeShape: "Hooded monolid, refined and composed",
      hair: "Straight black bob, chin-length, well-kept",
      ageRead: "Late 20s, polished without looking trying",
      buildNote: "Slim, composed posture, slim neck visible",
    },
    dallePromptLocked:
      "Vertical lo-fi selfie photo. Young Chinese Singaporean woman, 29 years old, oval symmetrical face, fair cool-neutral skin tone NC15, refined hooded monolid eyes, straight black chin-length bob, slim composed posture. She is seated in a treatment chair just after a procedure, looking softly at the camera — expression is calm, slightly satisfied, no big smile. Subtle skin sheen on cheeks and forehead indicating fresh skin booster or Profhilo. Clinic wristband on wrist. Simple understated clothing. Top 25-30% of frame is open breathing room for text overlay. iPhone front camera quality, no colour grading, slight grain, soft ambient clinic lighting. Not professional photography. Real camera roll aesthetic.",
    klingDirection: {
      setting: "Treatment chair, slightly reclined, just finished",
      motion: "Slow deliberate turn toward camera, one light touch to cheek",
      energy: "Calm, small knowing smile, no sudden movements",
      lighting: "Soft ambient — clinic overhead, not beauty lit",
      avoid: ["Fast cuts", "excitement gestures", "mirror selfie setting"],
    },
    voiceCaptionStyle: {
      voice: "Measured, moderate pace, slight exhale quality",
      captionStyle: "Sentence case, minimal punctuation, clean",
      sampleHook: "three sessions in. this is just how my skin looks now.",
      sampleCta: "link in bio if you want to know which clinic.",
    },
    mutuallyExclusiveWithIds: [],
    status: "active",
  },
};

const felicia: RosterEntry = {
  creatorIdentity: { id: "cid_synth_felicia_my_03", name: "Felicia", kind: "synthetic" },
  synthetic: {
    creatorIdentityId: "cid_synth_felicia_my_03",
    treatmentClass: "med_spa",
    vibe: "telling_her_friend",
    market: "MY",
    ethnicityFamily: "my_chinese",
    ageBand: "mid_20s",
    pricePositioning: "entry",
    physicalDescriptors: {
      faceShape: "Round, soft cheeks, friendly open face",
      skinTone: "Medium warm, yellow undertone, NC30",
      eyeShape: "Large double eyelid, expressive and animated",
      hair: "Highlighted warm brown, shoulder-length, slightly wavy, loose",
      ageRead: "Mid-20s, relatable girl-next-door",
      buildNote: "Average, approachable, slightly fuller shoulders",
    },
    dallePromptLocked:
      "Vertical lo-fi selfie photo. Young Malaysian Chinese woman, 25 years old, round face with soft cheeks, medium warm skin tone with yellow undertone NC30, large expressive double-eyelid eyes, shoulder-length warm brown highlighted wavy hair worn loose. She is in a clinic bathroom mirror, holding up phone to film herself mid-expression — caught mid-sentence, mouth slightly open, one eyebrow raised like she's about to share something exciting. Slight flush on cheeks, subtle sheen on skin. Clinic wristband on wrist. Casual everyday clothes. Top 25-30% of frame is open breathing room for text overlay. iPhone front camera quality, no colour grading, slight grain, fluorescent bathroom lighting. Not professional photography. Real camera roll aesthetic.",
    klingDirection: {
      setting: "Clinic bathroom mirror, very close to mirror",
      motion: "Leaning in like she's whispering, head tilt mid-sentence",
      energy: "Conspiratorial, occasional laugh-break, fast asides",
      lighting: "Fluorescent bathroom — imperfect and real",
      avoid: ["Calm energy", "looking away from camera", "staged composition"],
    },
    voiceCaptionStyle: {
      voice: "Malaysian English rhythm, slightly faster, warm and breathy",
      captionStyle: 'Lowercase, conversational, occasional "bestie" / "omg"',
      sampleHook: "okay I wasn't going to tell anyone but I have to",
      sampleCta: "dm me the clinic details bestie I'll send u",
    },
    mutuallyExclusiveWithIds: [],
    status: "active",
  },
};

const amanda: RosterEntry = {
  creatorIdentity: { id: "cid_synth_amanda_my_04", name: "Amanda", kind: "synthetic" },
  synthetic: {
    creatorIdentityId: "cid_synth_amanda_my_04",
    treatmentClass: "dental",
    vibe: "seven_days_later",
    market: "MY",
    ethnicityFamily: "my_chinese",
    ageBand: "early_30s",
    pricePositioning: "standard",
    physicalDescriptors: {
      faceShape: "Square-ish, defined jawline, structured",
      skinTone: "Medium, olive undertone, NC35",
      eyeShape: "Almond, single eyelid, composed and direct",
      hair: "Dark brown, practical ponytail or tied back cleanly",
      ageRead: "Early 30s, capable and put-together",
      buildNote: "Fit and toned, upright posture, slight shoulder definition",
    },
    dallePromptLocked:
      "Vertical lo-fi selfie photo. Malaysian Chinese woman, 31 years old, square-ish face with defined jawline, medium olive-undertone skin NC35, almond-shaped single eyelid eyes with composed direct gaze, dark brown hair pulled back in a neat ponytail. She is in a clinic waiting area, no makeup or minimal makeup, looking directly into camera with a calm satisfied expression — this is a results check-in. Her teeth are slightly visible in a soft smile showing whitened or improved dental results. Clinic wristband on wrist. Simple functional clothes. Top 25-30% of frame is open breathing room for text overlay. iPhone front camera quality, no colour grading, slight grain, clinic ambient lighting. Not professional photography. Real camera roll aesthetic.",
    klingDirection: {
      setting: "Clinic waiting area, seated upright, no-makeup",
      motion: "Minimal — slight head movement as she speaks, deliberate",
      energy: "Calm results debrief, not excited — like a check-in update",
      lighting: "Ambient clinic — neutral and unfussy",
      avoid: ["Bathroom mirror", "chaotic energy", "dramatic reveal"],
    },
    voiceCaptionStyle: {
      voice: "Even, measured, Malaysian English — slight clipping on consonants",
      captionStyle: "Sentence case, factual, numbered points work well",
      sampleHook: "week 7 of Invisalign. here's what nobody mentions.",
      sampleCta: "first consultation is free at this clinic. link below.",
    },
    mutuallyExclusiveWithIds: [],
    status: "active",
  },
};

const nana: RosterEntry = {
  creatorIdentity: { id: "cid_synth_nana_th_05", name: "Nana", kind: "synthetic" },
  synthetic: {
    creatorIdentityId: "cid_synth_nana_th_05",
    treatmentClass: "med_spa",
    vibe: "softly_glowing",
    market: "SG",
    ethnicityFamily: "thai_chinese",
    ageBand: "mid_20s",
    pricePositioning: "premium",
    physicalDescriptors: {
      faceShape: "Wide face with prominent cheekbones, slightly rounded",
      skinTone: "Golden-brown, warm peachy undertone — deeper than SG Chinese average",
      eyeShape: "Warm brown semi-monolid eyes, slightly downturned at outer corners",
      hair: "Dark brown, soft loose waves, worn down",
      ageRead: "24-26, Bangkok influencer energy not HK or Taiwanese",
      buildNote: "Soft and feminine, graceful posture",
    },
    dallePromptLocked:
      "Vertical lo-fi selfie photo. Thai-Chinese woman, 25 years old, wide face with prominent cheekbones, golden-brown warm peachy skin tone — deeper than typical Singaporean Chinese, warmer than Taiwanese, Bangkok influencer aesthetic. Warm brown semi-monolid eyes slightly downturned at outer corners, soft symmetrical features, fuller lips, slightly wider nose. Dark brown hair in soft loose waves worn down. She is seated in a treatment chair, looking softly into the camera with a calm slightly dazed expression — not smiling fully, just glowing. Strong skin sheen on cheeks and nose from fresh skin booster. Clinic wristband on wrist. Simple soft clothing. Top 25-30% of frame is open breathing room for text overlay. iPhone front camera quality, no colour grading, slight grain, soft clinic ambient lighting. Not professional photography. Real camera roll aesthetic.",
    klingDirection: {
      setting: "Treatment chair, soft recline, just post-procedure",
      motion: "Very slow turn toward camera, one hand gently touching cheek",
      energy: "Dazed, dreamy — like waking up from a nap",
      lighting: "Soft ambient — warm clinic light, no harsh overhead",
      avoid: ["Excited movement", "bathroom mirror", "fast cuts"],
    },
    voiceCaptionStyle: {
      voice: "Soft, slightly breathy, slow pace — pauses between thoughts",
      captionStyle: "Minimal, lowercase, almost poetic brevity",
      sampleHook: "my skin has never felt like this",
      sampleCta: "the treatment I got — link in bio",
    },
    mutuallyExclusiveWithIds: ["cid_synth_bua_th_10"],
    status: "active",
  },
};

const bianca: RosterEntry = {
  creatorIdentity: { id: "cid_synth_bianca_sg_06", name: "Bianca", kind: "synthetic" },
  synthetic: {
    creatorIdentityId: "cid_synth_bianca_sg_06",
    treatmentClass: "dental",
    vibe: "telling_her_friend",
    market: "SG",
    ethnicityFamily: "filipino_sg",
    ageBand: "mid_20s",
    pricePositioning: "entry",
    physicalDescriptors: {
      faceShape: "Soft heart-shaped, slightly wide at cheekbones, gentle chin",
      skinTone: "Medium warm caramel-brown, golden-peachy undertone — Filipino complexion",
      eyeShape: "Large warm brown eyes, slight natural uplift, friendly and open",
      hair: "Dark brown with subtle highlights, shoulder-length, loose natural waves",
      ageRead: "Mid-20s, bright and approachable — girl-next-door aspirational",
      buildNote: "Average-slim, relaxed posture, nothing athletic",
    },
    dallePromptLocked:
      "Vertical lo-fi selfie photo. Filipino Singaporean woman, 26 years old, soft heart-shaped face slightly wide at cheekbones with a gentle chin, medium warm caramel-brown skin with golden-peachy undertone — Filipino complexion, not Chinese, not Indian. Large warm brown eyes with slight natural uplift, friendly open expression. Dark brown shoulder-length hair with subtle highlights, loose natural waves. She is in a clinic bathroom mirror or just leaving clinic reception — holding phone up, warm open smile showing noticeably bright or improved teeth, slight flush on cheeks, skin sheen indicating recent treatment. Clinic wristband on wrist. Casual relaxed clothing. Top 25-30% of frame is open breathing room for text overlay. iPhone front camera quality, no colour grading, slight grain, fluorescent or ambient clinic lighting. Not professional photography. Real camera roll aesthetic.",
    klingDirection: {
      setting: "Clinic bathroom mirror or reception exit — either works",
      motion: "Natural head tilt mid-sentence, free hand gesturing lightly",
      energy: "Warm and spontaneous — like she's telling her barkada in real time",
      lighting: "Fluorescent bathroom or bright ambient lobby",
      avoid: ["Slow composed movements", "understated energy", "cool detachment"],
    },
    voiceCaptionStyle: {
      voice: "Filipino-accented Singapore English — warm, slightly melodic, fast pace",
      captionStyle: "Conversational, sentence case, light exclamation use, natural pauses",
      sampleHook: "okay I finally did it and I genuinely cannot stop smiling",
      sampleCta: "the clinic is in Orchard, details in bio — super worth it",
    },
    mutuallyExclusiveWithIds: [],
    status: "active",
  },
};

const hana: RosterEntry = {
  creatorIdentity: { id: "cid_synth_hana_my_07", name: "Hana", kind: "synthetic" },
  synthetic: {
    creatorIdentityId: "cid_synth_hana_my_07",
    treatmentClass: "halal_wellness",
    vibe: "just_left_clinic",
    market: "MY",
    ethnicityFamily: "my_malay",
    ageBand: "mid_20s",
    pricePositioning: "standard",
    physicalDescriptors: {
      faceShape: "Soft round face, gentle features",
      skinTone: "Medium warm brown, neutral-warm undertone — Malay complexion",
      eyeShape: "Warm brown almond eyes, soft and friendly",
      hair: "Wearing hijab — patterned or solid pastel, neatly tied",
      ageRead: "Mid-20s, approachable and relatable",
      buildNote: "Average, approachable, nothing athletic or model-like",
    },
    dallePromptLocked:
      "Vertical lo-fi selfie photo. Malaysian Malay woman, 26 years old, soft round face with gentle features, medium warm brown skin with neutral-warm undertone, warm brown almond eyes, wearing a hijab — neat and tidy, pastel or solid colour. She is in a clinic reception or bathroom, filming herself with a warm relaxed smile looking into camera. Slight sheen on face indicating fresh skin treatment. Clinic wristband on wrist. Modest casual clothing. Top 25-30% of frame is open breathing room for text overlay. iPhone front camera quality, no colour grading, slight grain, ambient clinic lighting. Not professional photography. Real camera roll aesthetic.",
    klingDirection: {
      setting: "Clinic reception or bathroom mirror",
      motion: "Warm smile expanding, slight lean into camera",
      energy: "Like telling a trusted friend — warm, not excitable",
      lighting: "Natural or ambient clinic light",
      avoid: ["Revealed hair", "non-modest clothing", "overly chaotic energy"],
    },
    voiceCaptionStyle: {
      voice: "Malaysian English with Malay warmth, gentle pace",
      captionStyle: 'Warm and conversational, "korang" energy, occasional BM',
      sampleHook: "finally found a clinic that only uses halal-certified products",
      sampleCta: "dm me if you want the details — ramai yang tanya",
    },
    mutuallyExclusiveWithIds: [],
    status: "active",
  },
};

const chloe: RosterEntry = {
  creatorIdentity: { id: "cid_synth_chloe_hk_08", name: "Chloe", kind: "synthetic" },
  synthetic: {
    creatorIdentityId: "cid_synth_chloe_hk_08",
    treatmentClass: "anti_ageing",
    vibe: "quiet_confidence",
    market: "HK",
    ethnicityFamily: "hk_chinese",
    ageBand: "mid_20s",
    pricePositioning: "premium",
    physicalDescriptors: {
      faceShape: "Sharp oval, defined features, refined jawline",
      skinTone: "Fair-light, cool undertone — classic HK aesthetic, NC15-NC20",
      eyeShape: "Double eyelid, refined almond, composed",
      hair: "Black, sleek and straight, mid-length with blunt ends",
      ageRead: "Late 20s, polished and self-possessed",
      buildNote: "Slim, elegant upright posture, graceful neck",
    },
    dallePromptLocked:
      "Vertical lo-fi selfie photo. Hong Kong Chinese woman, 28 years old, sharp oval face with defined features and refined jawline, fair cool-undertone skin NC15-NC20, refined almond double-eyelid eyes, sleek straight black mid-length hair with blunt ends. She is seated in a premium clinic treatment chair, looking softly at camera with a composed restrained expression — a slight suggestion of satisfaction, nothing expressive. Subtle skin sheen on cheeks. Clinic wristband on wrist. Understated quality clothing — not branded, but clearly good. Top 25-30% of frame is open breathing room for text overlay. iPhone front camera quality, no colour grading, slight grain, soft premium clinic lighting. Not professional photography. Real camera roll aesthetic but slightly more composed than average.",
    klingDirection: {
      setting: "Premium clinic treatment chair, composed",
      motion: "Very slow deliberate turn to camera, one gentle cheek touch",
      energy: "Restrained, no spontaneity — controlled and graceful",
      lighting: "Slightly warmer than average clinic — suggests premium space",
      avoid: ["Bathroom mirror", "fast movements", "ANY excited energy"],
    },
    voiceCaptionStyle: {
      voice: "Cantonese-inflected English or pure Cantonese for RED",
      captionStyle: "For RED: Chinese characters, elegant phrasing, minimal emoji",
      sampleHook: "this is what my skin looks like after the third session",
      sampleCta: "診所資訊在這裡",
    },
    mutuallyExclusiveWithIds: [],
    status: "active",
  },
};

const elaine: RosterEntry = {
  creatorIdentity: { id: "cid_synth_elaine_sg_09", name: "Elaine", kind: "synthetic" },
  synthetic: {
    creatorIdentityId: "cid_synth_elaine_sg_09",
    treatmentClass: "anti_ageing",
    vibe: "seven_days_later",
    market: "SG",
    ethnicityFamily: "sg_chinese",
    ageBand: "mid_30s_plus",
    pricePositioning: "premium",
    physicalDescriptors: {
      faceShape: "Oval, slightly fuller mid-face, refined",
      skinTone: "Light-medium, neutral undertone, slight natural warmth — NC25",
      eyeShape: "Hooded double eyelid, suggests age without looking aged",
      hair: "Dark with subtle caramel highlights, shoulder-length, softly styled",
      ageRead: "Early-mid 30s — looks good for her age, not trying to look younger",
      buildNote: "Composed, professional, nothing athletic — slight maturity in posture",
    },
    dallePromptLocked:
      "Vertical lo-fi selfie photo. Chinese Singaporean woman, 34 years old, oval face with slightly fuller mid-face, light-medium neutral-warm skin tone NC25, hooded double-eyelid eyes that convey maturity and composure, dark shoulder-length hair with subtle caramel highlights softly styled. She is in a clinic waiting area or treatment chair, no heavy makeup, looking directly at camera with a calm knowledgeable expression — this is a results check-in, not a performance. Subtle skin firmness and sheen indicating collagen or anti-ageing treatment. Clinic wristband on wrist. Quality but casual clothes. Top 25-30% of frame is open breathing room for text overlay. iPhone front camera quality, no colour grading, slight grain, ambient clinic lighting. Not professional photography. Real camera roll aesthetic.",
    klingDirection: {
      setting: "Clinic waiting area or treatment chair — composed",
      motion: "Deliberate, unhurried — small nod as she makes a point",
      energy: "Authority check-in — knowledgeable colleague not hype girl",
      lighting: "Neutral ambient — nothing that flatters aggressively",
      avoid: ["Chaotic energy", "mirror selfie", 'anything that reads "trying to look young"'],
    },
    voiceCaptionStyle: {
      voice: "SG English, measured, authoritative but warm",
      captionStyle: "Sentence case, slightly longer form, data-points welcomed",
      sampleHook: "34 years old. three months of HIFU. here's what actually changed.",
      sampleCta: "the clinic I go to. no referral fees, just genuinely good.",
    },
    mutuallyExclusiveWithIds: [],
    status: "active",
  },
};

const bua: RosterEntry = {
  creatorIdentity: { id: "cid_synth_bua_th_10", name: "Bua", kind: "synthetic" },
  synthetic: {
    creatorIdentityId: "cid_synth_bua_th_10",
    treatmentClass: "med_spa",
    vibe: "omg_look",
    market: "SG",
    ethnicityFamily: "thai_chinese",
    ageBand: "gen_z",
    pricePositioning: "entry",
    physicalDescriptors: {
      faceShape: "Round with wide cheekbones — baby-faced version of Thai-Chinese look",
      skinTone:
        "Golden-brown, peachy warm undertone — same ethnic family as Creator 05 but younger-reading",
      eyeShape: "Semi-monolid, warm brown, slightly downturned — bright and expressive",
      hair: "Black with curtain bangs, or ends dip-dyed — playful styling",
      ageRead: "20-22, unmistakably Gen Z",
      buildNote: "Petite, slight frame, youthful posture",
    },
    dallePromptLocked:
      "Vertical lo-fi selfie photo. Thai-Chinese woman, 22 years old, round baby-faced appearance with wide cheekbones, golden-brown warm peachy skin tone, semi-monolid warm brown eyes slightly downturned at outer corners, bright and expressive. Black hair with curtain bangs, slightly playful styling. She is in a clinic bathroom mirror or clinic waiting area, holding phone up with a big surprised-happy expression — mouth open, clearly delighted by her result. Subtle skin sheen on cheeks. Clinic wristband on wrist. Fun casual Gen Z clothing — layered, not styled. Top 25-30% of frame is open breathing room for text overlay. iPhone front camera quality, no colour grading, slight grain, fluorescent or ambient clinic lighting. Not professional photography. Real camera roll aesthetic.",
    klingDirection: {
      setting: "Clinic bathroom mirror or waiting area",
      motion: "Sudden excited lean forward, shoulder bounce, head shake",
      energy: "Big reactions, first-timer wonder, exaggerated but authentic",
      lighting: "Fluorescent or bright ambient — youthful and unfiltered",
      avoid: ["Calm", "composed", "slow movements", "anything mature-coded"],
    },
    voiceCaptionStyle: {
      voice: "Thai-accented English or Malaysian English Gen Z, fast and bright",
      captionStyle: 'Lowercase, fragments, "no but actually", emojis okay',
      sampleHook: "no but why did I wait until I was 22 to do this",
      sampleCta: "they have a first timer deal linked below!!",
    },
    mutuallyExclusiveWithIds: ["cid_synth_nana_th_05"],
    status: "active",
  },
};

export const SP11_SYNTHETIC_CREATOR_ROSTER: readonly RosterEntry[] = [
  cheryl,
  vivienne,
  felicia,
  amanda,
  nana,
  bianca,
  hana,
  chloe,
  elaine,
  bua,
] as const;

export const SP11_ROSTER_SIZE = SP11_SYNTHETIC_CREATOR_ROSTER.length;
