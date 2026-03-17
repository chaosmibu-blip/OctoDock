import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** 合併 tailwind class 名稱，處理衝突 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
