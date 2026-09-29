import { redirect } from "next/navigation"
import { AppShell } from "@/components/app-shell"
import { SettingsForm } from "@/components/settings-form"
import { currentUser } from "@/server/auth"

export default async function SettingsPage() {
  const user = await currentUser()
  if (!user) redirect("/login")
  return (
    <AppShell active='settings'>
      <div
        style={{ maxWidth: 820, margin: "0 auto", padding: "44px 42px 70px" }}
      >
        <h1
          style={{
            fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
            fontSize: 38,
            fontWeight: 400,
            marginTop: 0,
          }}
        >
          Настройки
        </h1>
        <SettingsForm user={user} />
      </div>
    </AppShell>
  )
}
