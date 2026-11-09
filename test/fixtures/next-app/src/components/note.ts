// no "use client" here, but CartView (a client component) imports it, so it ships to the browser
import { marked } from "marked";

export const renderNote = (s: string) => marked(s) as string;
