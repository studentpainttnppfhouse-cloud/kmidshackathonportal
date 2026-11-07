import NewEvent from "../../calendar/new/page";
export default async function NewMeeting({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const params = await searchParams;
  return NewEvent({
    searchParams: Promise.resolve({ ...params, kind: "meeting" }),
  });
}
