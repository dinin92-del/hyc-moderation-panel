"use client";

import { createContext, useContext } from "react";

export type PointCardApi = {
  /** Otwiera kartę punktu, adres dostaje `?punkt=<id>`. */
  openCard: (pointId: string) => void;
  /** Wczytuje punkt razem z danymi z bazy i otwiera edycję. */
  openEdit: (pointId: string, onSaved?: () => void) => void;
};

export const PointCardContext = createContext<PointCardApi>({
  openCard: () => {},
  openEdit: () => {},
});

export const usePointCard = () => useContext(PointCardContext);
