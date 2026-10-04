/**
 * Coffre : sections JSON chiffrées AES-256-GCM, stockées dans Mongo (`vault`).
 * Une section = un blob opaque { _id: "<userId>:<section>", userId, data, updatedAt },
 * chiffré avec la clé propre à l'utilisateur (dérivée de VAULT_KEY).
 *
 * Sections utilisées :
 *  - "guarantors"          : Guarantor[] (tous les champs iBail des garants)
 *  - "applicationProfile"  : ApplicationProfile (défauts étape 4, préférences)
 *  - "ibailSession"        : storageState Playwright (cookies iBail) — écrit par l'agent
 */
import { getDb } from "./db";
import { decryptJson, encryptJson, userKey } from "./crypto";

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

interface VaultDoc {
  _id: string; // `${userId}:${section}`
  userId: string;
  section: string;
  data: string;
  updatedAt: Date;
}

const docId = (userId: string, section: string) => `${userId}:${section}`;

/** Lit une section du coffre d'un utilisateur (déchiffrée avec SA clé). */
export async function getVaultSection<T>(userId: string, section: string): Promise<T | null> {
  const db = await getDb();
  const doc = await db
    .collection<VaultDoc>(VAULT)
    .findOne({ _id: docId(userId, section), userId });
  if (!doc) return null;
  return decryptJson<T>(doc.data, userKey(userId));
}

export async function setVaultSection(
  userId: string,
  section: string,
  value: unknown,
): Promise<void> {
  const db = await getDb();
  await db.collection<VaultDoc>(VAULT).updateOne(
    { _id: docId(userId, section) },
    {
      $set: {
        userId,
        section,
        data: encryptJson(value, userKey(userId)),
        updatedAt: new Date(),
      },
    },
    { upsert: true },
  );
}

/** Métadonnées non sensibles pour l'UI (existence + fraîcheur, jamais le contenu). */
export async function vaultStatus(
  userId: string,
): Promise<Array<{ section: string; updatedAt: Date | null }>> {
  const db = await getDb();
  const docs = await db
    .collection<VaultDoc>(VAULT)
    .find({ userId }, { projection: { section: 1, updatedAt: 1 } })
    .toArray();
  return docs.map((d) => ({ section: d.section, updatedAt: d.updatedAt ?? null }));
}
