/**
 * Option lists for the Pre-register, Contact and brochure forms. The ids must
 * match the inquiry dashboard API (sloka-academy-backend), which rejects
 * anything else. Stream ids come from src/data/streams.ts.
 */

export type InquirySource = "pre-register" | "contact" | "brochure";

export const YEARS_OF_STUDY = [
  { id: "year-1", label: "1st year" },
  { id: "year-2", label: "2nd year" },
  { id: "year-3", label: "3rd year" },
  { id: "year-4", label: "4th year" },
  { id: "year-5", label: "5th year" },
  { id: "graduated", label: "Graduated" },
  { id: "working", label: "Working professional" },
] as const;
