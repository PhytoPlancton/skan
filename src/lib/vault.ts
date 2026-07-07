/**
 * Coffre : sections JSON chiffrées AES-256-GCM, stockées dans Mongo (`vault`).
 * Une section = un blob opaque { _id, data(base64 chiffré), updatedAt }.
 *
 * Sections utilisées :
 *  - "guarantors"          : Guarantor[] (tous les champs iBail des garants)
 *  - "applicationProfile"  : ApplicationProfile (défauts étape 4, préférences)
 *  - "ibailSession"        : storageState Playwright (cookies iBail) — écrit par l'agent
 */
import { getDb } from "./db";
import { decryptJson, encryptJson } from "./crypto";

const VAULT = "vault";

export interface Guarantor {
  situation: string;
  civility: "Monsieur" | "Madame";
  lastName: string;
  firstName: string;
  email: string;
  phone: string;
  address: string;
  zipCode: string;
  city: string;
  country: string;
  nationality: string;
  birthDate: string; // dd/mm/yyyy
  birthCity: string;
  birthCountry: string;
  familyStatus: string;
  kinship: string;
  // Situation professionnelle
  companyName: string;
  employerAddress: string;
  employerZipCode: string;
  employerCity: string;
  employerPhone: string;
  profession: string;
  hireDate: string; // dd/mm/yyyy
  contractType: string;
  taxIncomeN1: string;
  taxIncomeN2: string;
  monthlyNetIncome: string;
  monthlyFamilyAllowance: string;
  otherMonthlyIncome: string;
  otherIncomeNature: string;
  housingStatus: string;
  monthlyRent: string;
  otherMonthlyCharges: string;
}

export interface ApplicationProfile {
  /** Date de sortie souhaitée par défaut (dd/mm/yyyy). */
  defaultExitDate: string;
  /** Réponse « Comment avez-vous connu ARPEJ ? ». */
  howKnown: string;
  /** Plancher optionnel pour la date d'entrée (dd/mm/yyyy, vide = aucun). */
  entryDateFloor: string;
}

export async function getVaultSection<T>(section: string): Promise<T | null> {
  const db = await getDb();
  const doc = await db
    .collection<{ _id: string; data: string }>(VAULT)
    .findOne({ _id: section });
  if (!doc) return null;
  return decryptJson<T>(doc.data);
}

export async function setVaultSection(section: string, value: unknown): Promise<void> {
  const db = await getDb();
  await db.collection<{ _id: string; data: string; updatedAt: Date }>(VAULT).updateOne(
    { _id: section },
    { $set: { data: encryptJson(value), updatedAt: new Date() } },
    { upsert: true },
  );
}

/** Métadonnées non sensibles pour l'UI (existence + fraîcheur, jamais le contenu). */
export async function vaultStatus(): Promise<
  Array<{ section: string; updatedAt: Date | null }>
> {
  const db = await getDb();
  const docs = await db
    .collection<{ _id: string; updatedAt?: Date }>(VAULT)
    .find({}, { projection: { _id: 1, updatedAt: 1 } })
    .toArray();
  return docs.map((d) => ({ section: d._id, updatedAt: d.updatedAt ?? null }));
}
