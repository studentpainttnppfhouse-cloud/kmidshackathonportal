import type { CQuestion, CSection, CStage, CompetitionDefinition, Track } from "@/lib/competition/schema";

/**
 * The 2027 Round 1 templates, copied from the approved specification
 * ("KMIDS Hackathon 2027: website forms plan", 27 November 2026, sections 6–9).
 *
 * Installing a template makes an editable copy. Nothing here is read again
 * once a copy exists, so editing a live form never changes this file and
 * changing this file never rewrites a form somebody already edited.
 *
 * Part G (the optional essay bank) is gone on purpose. Stage H is written out
 * in full but every workflow starts with it switched off.
 */

export const TEMPLATE_KEY = "round1-2027";
export const TEMPLATE_YEAR = 2027;

const yesNo = ["Yes", "No"];
const supportOptions = ["No", "Yes, contact our representative", "Prefer to discuss privately"];

function confirm(id: string, label: string, confirmLabel = "I confirm"): CQuestion {
  return { id, type: "confirm", label, required: true, confirmLabel, locked: true };
}

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

/**
 * Member documents, requested to match the information booklet: a national ID
 * card (or passport) and a ปพ.7 student status certificate for every member.
 * An author can switch either off per track without touching the code.
 */
function memberDocuments(p: "I" | "E"): CQuestion[] {
  return [
    {
      id: `${p}-C{n}-06`,
      type: "document",
      label: "Upload a copy of Member {n}'s national ID card, or passport if they do not hold a Thai ID card.",
      help: "A clear photo or PDF. Only the organizing admins can open it, and it is used to check eligibility.",
      required: true,
      enabled: true,
    },
    {
      id: `${p}-C{n}-07`,
      type: "document",
      label: "Upload Member {n}'s ปพ.7 (student status certificate) issued by their school.",
      help: "A clear photo or PDF of the school-issued certificate. Only the organizing admins can open it.",
      required: true,
      enabled: true,
    },
  ];
}

function afterMembers(p: "I" | "E"): CQuestion[] {
  return [
    {
      id: `${p}-C06`,
      type: "short_text",
      label: "What LINE ID should staff use for the team representative, if needed?",
      help: p === "I" ? "Team representative only" : undefined,
      required: false,
    },
    {
      id: `${p}-C07`,
      type: "radio",
      label: "Does your team need staff to contact you about access or participation support?",
      required: false,
      options: supportOptions,
    },
    {
      id: `${p}-C08`,
      type: "long_text",
      label: "Is there anything else the organizers should know about this registration?",
      help: "Administrative notes only. Do not include medical records or identity documents.",
      required: false,
    },
  ];
}

// ---------------------------------------------------------------------------
// Stage F: Round 1 submission (section 8)
// ---------------------------------------------------------------------------

const F_INTRO = `Prepare **one Google Drive folder** containing all three required items:

1. Your video pitch, no longer than 4 minutes.
2. Your pitch deck as one PDF containing 6-10 slides.
3. Your Impact Brief as a one-page PDF explaining the problem, who it affects, your solution and the intended impact.

Your Round 1 work may be in English or Thai. A physical prototype is not required.

**Folder name:** \`{TeamID}_{TeamName}_Round1_2027\`

**File names inside the folder:**

- \`{TeamID}_{TeamName}_VideoPitch.mp4\`
- \`{TeamID}_{TeamName}_PitchDeck.pdf\`
- \`{TeamID}_{TeamName}_ImpactBrief.pdf\`

Use the exact issued team ID. For the folder and file name version of your team name, replace spaces with underscores and remove characters such as / \\ : * ? " < > |. Your own names are shown above, ready to copy.

An MP4 file is the simplest way to include the video. If you use an unlisted YouTube video instead, put a PDF named \`{TeamID}_{TeamName}_VideoPitchLink.pdf\` in the same folder containing a clickable unlisted YouTube URL. Use either the MP4 or the link PDF, not both. A YouTube URL on its own does not replace the folder link below.

**How to share and check your folder:**

1. Create a folder containing only the competition work listed above. Do not include payment slips, guardian forms, real patient records or private identity documents.
2. Add the three required items and give them the correct names.
3. Use the reviewer access method shown by the organizers. If "Anyone with the link: Viewer" is allowed by your school, apply it and test the folder and each file while signed out. If your school blocks link sharing, share Viewer access with the exact reviewer account the organizers give you and ask for an access check before final submission. Do not guess the reviewer email.
4. Confirm that every file can be opened, downloaded or played as appropriate, including the video and any YouTube link.
5. Copy the Google Drive **folder link**, not the link to one file. Paste that one link below.
6. Check your files carefully before pressing **Submit final Round 1 entry**. After final submission, do not replace, rename, remove or edit the submitted work or change its access. Late or edited work is not accepted under the published rules.`;

function stageF(p: "I" | "E"): CStage {
  return {
    key: "F",
    title: "Round 1: Submit your team's work",
    intro: F_INTRO,
    sections: [
      {
        key: "F",
        title: "Round 1 submission",
        questions: [
          { id: `${p}-F01`, type: "display", display: "team_code", label: "Team ID", required: false, locked: true },
          { id: `${p}-F02`, type: "display", display: "team_name", label: "Team name", required: false, locked: true },
          { id: `${p}-F03`, type: "short_text", label: "What is your project title?", required: true },
          {
            id: `${p}-F04`,
            type: "radio",
            label: "What language is your Round 1 work in?",
            required: true,
            options: ["English", "Thai"],
          },
          {
            id: `${p}-F05`,
            type: "drive_folder",
            label: "Paste the Google Drive folder link containing your video pitch, pitch deck and Impact Brief.",
            help: "The link to the folder, starting https://drive.google.com/drive/folders/",
            required: true,
            locked: true,
          },
          {
            id: `${p}-F06`,
            type: "duration",
            label: "How long is your video pitch?",
            help: "Minutes and seconds, like 03:45. At most 04:00. Staff check the real length.",
            required: true,
            locked: true,
          },
          confirm(
            `${p}-F07`,
            "Our folder contains the required video pitch, the 6-10 slide PDF deck and the one-page PDF Impact Brief, with the required names.",
          ),
          confirm(
            `${p}-F08`,
            "We have checked that the organizers can open all required files and play the video using the published access method.",
          ),
          confirm(
            `${p}-F09`,
            "The work is original to our team, sources are credited, and we have followed the published assistance and AI rules.",
          ),
          confirm(
            `${p}-F10`,
            "We understand this is our final Round 1 submission, it cannot be edited after submission, and we must not change the submitted folder contents or access.",
            "I understand",
          ),
        ],
      },
    ],
    submitLabel: "Submit final Round 1 entry",
    receipt:
      "Your final Round 1 entry for **{teamId}** was received on **{BangkokTimestamp}**. Your submission reference is **{submissionReference}**. Your answers are now locked. Keep your submitted folder and access unchanged. Finalist results are scheduled for 8 March 2027.",
  };
}

// ---------------------------------------------------------------------------
// Stage H: finalist confirmation, draft only (section 9)
// ---------------------------------------------------------------------------

function stageH(track: Track): CStage {
  const p = track === "internal" ? "I" : "E";
  const supervisor: CQuestion[] =
    track === "external"
      ? [
          {
            id: `${p}-H06`,
            type: "radio",
            label: "Will a school supervisor attend?",
            required: false,
            options: ["Yes", "No", "Not yet confirmed"],
          },
          {
            id: `${p}-H07`,
            type: "radio",
            label: "Does your supervisor need parking information?",
            help: "Answer if your supervisor is attending.",
            required: false,
            options: ["Yes", "No"],
            showIf: { q: `${p}-H06`, equals: "Yes" },
          },
        ]
      : [];

  return {
    key: "H",
    title: "Finalist confirmation and onboarding",
    intro:
      "Congratulations on being selected for the KMIDS Hackathon 2027 final. Please confirm your full team's attendance for 20-21 March 2027 at KMIDS by 17 March 2027. Your registered roster must remain unchanged. The final is conducted in English and uses a new prompt revealed on Day 1.",
    sections: [
      {
        key: "H",
        title: "Finalist confirmation",
        questions: [
          { id: `${p}-H01`, type: "display", display: "roster", label: "Team ID and registered roster", required: false, locked: true },
          {
            id: `${p}-H02`,
            type: "radio",
            label: "Will your complete registered team attend on both 20 and 21 March 2027?",
            required: true,
            options: ["Yes", "No", "Need organizer assistance"],
          },
          {
            id: `${p}-H03`,
            type: "radio",
            label: "Is your roster unchanged from Round 1?",
            help: "If not, staff will review it. Substitutions are not permitted.",
            required: true,
            options: yesNo,
            locked: true,
          },
          { id: `${p}-H04`, type: "member_select", label: "Who is the primary event-day contact?", required: true, locked: true },
          {
            id: `${p}-H05`,
            type: "short_text",
            label: "What phone number can staff use on the event days?",
            help: "International formats accepted",
            required: true,
          },
          ...supervisor,
          {
            id: `${p}-H08`,
            type: "radio",
            label: "Has every member completed the school-approved guardian consent process?",
            help: "Staff verify individual records.",
            required: true,
            options: ["Completed", "Pending", "Need help"],
          },
        ],
        memberQuestions: [
          {
            id: `${p}-H-C{n}-01`,
            type: "short_text",
            label: "Who is Member {n}'s emergency contact?",
            help: "Name and relationship",
            required: true,
          },
          { id: `${p}-H-C{n}-02`, type: "short_text", label: "What is that emergency contact's phone number?", required: true },
          {
            id: `${p}-H-C{n}-03`,
            type: "long_text",
            label: "Does Member {n} have dietary restrictions or food allergies catering staff need to know?",
            help: "Private operational details only. You can also contact staff directly.",
            required: false,
          },
          {
            id: `${p}-H-C{n}-04`,
            type: "long_text",
            label: "Does Member {n} need an accessibility arrangement or a private discussion with staff?",
            help: "No diagnosis is needed.",
            required: false,
          },
          {
            id: `${p}-H-C{n}-05`,
            type: "short_text",
            label: "Does Member {n}'s certificate spelling need correction?",
            help: "Spelling correction only",
            required: false,
          },
        ],
        after: [
          confirm(`${p}-H09`, "We understand the final presentation is 6 minutes plus 4 minutes of Q&A in English.", "I understand"),
          confirm(
            `${p}-H10`,
            "We understand that the final PDF is due by 17:00 on Saturday 20 March 2027, with no late submissions or edits.",
            "I understand",
          ),
          confirm(
            `${p}-H11`,
            "We understand participants should wear school uniform and follow the published arrival and venue instructions.",
            "I understand",
          ),
        ],
      },
    ],
    submitLabel: "Confirm our place",
    receipt: "Thank you. Your finalist confirmation for **{teamId}** was received on **{BangkokTimestamp}**.",
  };
}

// ---------------------------------------------------------------------------
// Internal track (section 6)
// ---------------------------------------------------------------------------

const INTERNAL_INTRO = `Welcome to KMIDS Hackathon 2027: MedTech & Digital Health. This registration is for teams made entirely of KMIDS students. You may enter with 1-4 members, and entry is free. Any number of KMIDS teams may join the online qualifier. The top 3 KMIDS teams will advance to the final at KMIDS on 20-21 March 2027.

Round 1 requires a video pitch of no more than 4 minutes, a 6-10 slide PDF pitch deck, and a one-page PDF Impact Brief. Your work may be in English or Thai. After registering, you will receive a team ID and can submit your work together using one Google Drive folder link in Part F.

Read the published prompt, Rules & Information, rubric and privacy notice before registering. The published deadline and time appear above this form. Registration does not guarantee a finalist place.`;

function internalSections(): CSection[] {
  return [
    {
      key: "A",
      title: "A. Eligibility and team details",
      questions: [
        {
          id: "I-A01",
          type: "radio",
          label: "Are all members currently KMIDS secondary school students?",
          required: true,
          options: yesNo,
          stop: {
            value: "No",
            message:
              "The internal track is for teams made entirely of current KMIDS secondary school students. Teams with students from other schools should use the external registration, and cannot include any KMIDS student.",
          },
          locked: true,
        },
        {
          id: "I-A02",
          type: "radio",
          label: "Is every listed member entering KMIDS Hackathon 2027 on this team only?",
          required: true,
          options: yesNo,
          stop: {
            value: "No",
            message: "Each student may enter on one team only. Please sort this out with your team before registering.",
          },
          locked: true,
        },
        {
          id: "I-A03",
          type: "short_text",
          label: "What is your team name?",
          help: "Use the same spelling on your files and folder",
          required: true,
          locked: true,
        },
        {
          id: "I-A04",
          type: "member_count",
          label: "How many members are on your team?",
          required: true,
          options: ["1", "2", "3", "4"],
          locked: true,
        },
      ],
    },
    {
      key: "C",
      title: "C. Member details",
      intro: "One block per member. Member 1 is the team representative.",
      questions: [],
      memberQuestions: [
        {
          id: "I-C{n}-01",
          type: "short_text",
          label: "What is Member {n}'s full name?",
          help: "Use the spelling required on the certificate",
          required: true,
          locked: true,
        },
        { id: "I-C{n}-02", type: "short_text", label: "What is Member {n}'s nickname?", required: false },
        {
          id: "I-C{n}-03",
          type: "short_text",
          label: "What is Member {n}'s grade level?",
          help: "Current secondary-school grade",
          required: true,
        },
        { id: "I-C{n}-04", type: "short_text", label: "What is Member {n}'s KMIDS class?", required: true },
        {
          id: "I-C{n}-05",
          type: "email",
          label: "What is Member {n}'s email address?",
          help: "Member 1 receives team correspondence",
          required: true,
          locked: true,
        },
        ...memberDocuments("I"),
      ],
      after: afterMembers("I"),
    },
    {
      key: "D",
      title: "D. Team acknowledgements",
      intro: "Once for the whole team.",
      questions: [
        confirm("I-D01", "All listed members know they have been registered and agree to join this team."),
        confirm("I-D02", "Our team meets the KMIDS-only eligibility rules, and every member is entering on this team only."),
        confirm(
          "I-D03",
          "We understand that this is an online qualifier and only the top 3 KMIDS teams advance to the on-site final.",
          "I understand",
        ),
        confirm(
          "I-D04",
          "We understand that Round 1 requires a video pitch of no more than 4 minutes, a 6-10 slide PDF deck and a one-page PDF Impact Brief, submitted together through Part F by the published deadline.",
          "I understand",
        ),
        confirm(
          "I-D05",
          "We understand that Round 1 may be in English or Thai, while the on-site final is conducted in English with the same registered members and no substitutions.",
          "I understand",
        ),
        confirm(
          "I-D06",
          "We understand that the final is on 20-21 March 2027, selected teams confirm by 17 March, the final uses a new prompt, and Round 1 scores do not carry forward.",
          "I understand",
        ),
        confirm(
          "I-D07",
          "We have read the published Rules & Information, including the prohibition on AI-generated or AI-assisted ideas and its stated disqualification consequences.",
        ),
        confirm("I-D08", "Our representative will check event messages and share them with the whole team."),
        confirm("I-D09", "We confirm that these registration details are accurate and have read the event privacy notice."),
      ],
    },
  ];
}

// ---------------------------------------------------------------------------
// External track (section 7)
// ---------------------------------------------------------------------------

const EXTERNAL_INTRO = `Welcome to KMIDS Hackathon 2027: MedTech & Digital Health. This registration is for secondary school students studying in Thailand outside KMIDS. Teams may have 1-4 members from the same or different schools. Teams containing KMIDS students are not eligible for the external track.

The Round 1 registration fee is 599 THB per team. The top 20 external teams advance to the final at KMIDS on 20-21 March 2027. Paying the fee does not guarantee a finalist place.

After registering, you will receive a team ID. Submit your Round 1 video pitch, PDF deck and PDF Impact Brief together using one Google Drive folder link in Part F. Round 1 work may be in English or Thai. Read the published prompt, rules, rubric, payment terms and privacy notice before registering. The published deadline and time appear above the form.`;

function externalSections(): CSection[] {
  return [
    {
      key: "A",
      title: "A. Eligibility and team details",
      questions: [
        {
          id: "E-A01",
          type: "radio",
          label: "Are all members currently secondary school students studying in Thailand?",
          required: true,
          options: yesNo,
          stop: {
            value: "No",
            message: "KMIDS Hackathon 2027 is open to secondary school students studying in Thailand.",
          },
          locked: true,
        },
        {
          id: "E-A02",
          type: "radio",
          label: "Does your team include any KMIDS student?",
          required: true,
          options: ["No", "Yes"],
          stop: {
            value: "Yes",
            message:
              "Teams that include a KMIDS student cannot enter the external track. Internal teams must be made up of KMIDS students only, so a mixed team cannot register on either track.",
          },
          locked: true,
        },
        {
          id: "E-A03",
          type: "radio",
          label: "Is every listed member entering KMIDS Hackathon 2027 on this team only?",
          required: true,
          options: yesNo,
          stop: {
            value: "No",
            message: "Each student may enter on one team only. Please sort this out with your team before registering.",
          },
          locked: true,
        },
        {
          id: "E-A04",
          type: "short_text",
          label: "What is your team name?",
          help: "Same spelling on folder, files and payment records",
          required: true,
          locked: true,
        },
        {
          id: "E-A05",
          type: "member_count",
          label: "How many members are on your team?",
          required: true,
          options: ["1", "2", "3", "4"],
          locked: true,
        },
      ],
    },
    {
      key: "B",
      title: "B. Supervisor information",
      intro: "A supervisor is not required to register for the online qualifier.",
      questions: [
        {
          id: "E-B01",
          type: "radio",
          label: "Does your team have a school supervisor or teacher contact?",
          required: false,
          options: ["Yes", "Not yet"],
          locked: true,
        },
        {
          id: "E-B02",
          type: "short_text",
          label: "What is your supervisor's full name?",
          required: true,
          showIf: { q: "E-B01", equals: "Yes" },
        },
        {
          id: "E-B03",
          type: "short_text",
          label: "What is your supervisor's position or role?",
          required: false,
          showIf: { q: "E-B01", equals: "Yes" },
        },
        {
          id: "E-B04",
          type: "short_text",
          label: "Which school or organization does your supervisor represent?",
          required: true,
          showIf: { q: "E-B01", equals: "Yes" },
        },
        {
          id: "E-B05",
          type: "email",
          label: "What is your supervisor's email address?",
          required: true,
          showIf: { q: "E-B01", equals: "Yes" },
        },
        {
          id: "E-B06",
          type: "short_text",
          label: "What is your supervisor's phone number?",
          help: "International formats accepted",
          required: false,
          showIf: { q: "E-B01", equals: "Yes" },
        },
      ],
    },
    {
      key: "C",
      title: "C. Member details",
      intro: "One block per member. Member 1 is the team representative. Members may come from different schools.",
      questions: [],
      memberQuestions: [
        {
          id: "E-C{n}-01",
          type: "short_text",
          label: "What is Member {n}'s full name?",
          help: "Certificate spelling",
          required: true,
          locked: true,
        },
        { id: "E-C{n}-02", type: "short_text", label: "What is Member {n}'s nickname?", required: false },
        {
          id: "E-C{n}-03",
          type: "short_text",
          label: "Which school does Member {n} attend?",
          help: "Mixed external schools are allowed",
          required: true,
        },
        {
          id: "E-C{n}-04",
          type: "short_text",
          label: "What is Member {n}'s grade level or secondary-school equivalent?",
          required: true,
        },
        {
          id: "E-C{n}-05",
          type: "email",
          label: "What is Member {n}'s email address?",
          help: "Member 1 receives team correspondence",
          required: true,
          locked: true,
        },
        ...memberDocuments("E"),
      ],
      after: afterMembers("E"),
    },
    {
      key: "D",
      title: "D. Team acknowledgements",
      intro: "Once for the whole team.",
      questions: [
        confirm("E-D01", "All listed members know they have been registered and agree to join this team."),
        confirm(
          "E-D02",
          "All members meet the external eligibility rules, none is a KMIDS student, and every member is entering on this team only.",
        ),
        confirm(
          "E-D03",
          "We understand that this is an online qualifier and the top 20 external teams advance to the final.",
          "I understand",
        ),
        confirm(
          "E-D04",
          "We understand that Round 1 requires a video of no more than 4 minutes, a 6-10 slide PDF deck and a one-page PDF Impact Brief, submitted together through Part F by the published deadline.",
          "I understand",
        ),
        confirm(
          "E-D05",
          "We understand that Round 1 may be in English or Thai and the final is conducted in English with the same registered members and no substitutions.",
          "I understand",
        ),
        confirm(
          "E-D06",
          "We understand that the final is on 20-21 March 2027, selected teams confirm by 17 March, the final uses a new prompt, and Round 1 scores do not carry forward.",
          "I understand",
        ),
        confirm(
          "E-D07",
          "We have read the published Rules & Information, including the prohibition on AI-generated or AI-assisted ideas and its stated disqualification consequences.",
        ),
        confirm("E-D08", "Our representative will check event messages and share them with the whole team."),
        confirm("E-D09", "We confirm that these registration details are accurate and have read the event privacy notice."),
      ],
    },
    {
      key: "E",
      title: "E. Payment",
      intro: "Pay the Round 1 fee using the payee details above, then tell us about the payment.",
      questions: [
        { id: "E-E01", type: "short_text", label: "What is the payer's name?", required: true },
        {
          id: "E-E02",
          type: "number",
          label: "How much did you pay in THB?",
          help: "The fee is 599 THB per team.",
          required: true,
          expect: "599",
        },
        { id: "E-E03", type: "date", label: "On what date did you pay?", required: true },
        {
          id: "E-E04",
          type: "time",
          label: "At what time did you pay?",
          help: "Bangkok time, 24-hour, like 14:05",
          required: true,
        },
        {
          id: "E-E05",
          type: "short_text",
          label: "What is the transaction reference?",
          help: "If available on the receipt",
          required: false,
        },
        {
          id: "E-E06",
          type: "proof",
          label: "Provide your payment slip.",
          help: "Upload a photo or PDF of the slip, or paste a direct share link to the receipt. Never share banking passwords.",
          required: true,
          proofMode: "either",
          locked: true,
        },
        confirm(
          "E-E07",
          "We understand that this 599 THB payment is for Round 1 participation and does not guarantee selection for the final.",
          "I understand",
        ),
      ],
    },
  ];
}

export function buildTemplate(track: Track): CompetitionDefinition {
  const internal = track === "internal";
  return {
    kind: "competition",
    version: 2,
    templateKey: TEMPLATE_KEY,
    track,
    year: TEMPLATE_YEAR,
    title: internal
      ? "KMIDS Hackathon 2027: Internal Team Registration"
      : "KMIDS Hackathon 2027: External Team Registration",
    intro: internal ? INTERNAL_INTRO : EXTERNAL_INTRO,
    sections: internal ? internalSections() : externalSections(),
    registerLabel: "Register team",
    receipt: internal
      ? "Your internal registration has been saved. Your team ID is **{teamId}**. Entry is free. Registration is not confirmation of a finalist place. Use this ID to name your Round 1 folder, then continue to Part F or return through your secure continuation link before the published deadline."
      : "Your external registration has been saved. Your team ID is **{teamId}**. Payment and eligibility will be checked by staff. Registration does not guarantee a finalist place. Use this ID to name your Round 1 folder, then continue to Part F or return through your secure continuation link before the published deadline.",
    f: stageF(internal ? "I" : "E"),
    h: stageH(track),
  };
}

export const TEMPLATE_LABEL: Record<Track, string> = {
  internal: "Internal Round 1 2027",
  external: "External Round 1 2027",
};
