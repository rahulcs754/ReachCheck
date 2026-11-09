"use client";
import { renderNote } from "./note";

export default function CartView({ note }: { note: string }) {
  return <div dangerouslySetInnerHTML={{ __html: renderNote(note) }} />;
}
