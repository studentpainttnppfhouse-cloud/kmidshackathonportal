"use server";
import {redirect} from "next/navigation";
import type {FormState} from "./auth";
export async function createCalendarEvent(_prev:FormState,f:FormData):Promise<FormState>{const id=String(f.get("id")??"");redirect(id?`/calendar/${encodeURIComponent(id)}`:"/calendar/new?kind=meeting");}
export async function deleteCalendarEvent(id:string):Promise<void>{redirect(`/calendar/${encodeURIComponent(id)}`);}
