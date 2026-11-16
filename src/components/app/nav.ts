import {
  LayoutDashboard, Search, Building2, ClipboardCheck, Palette, Wand2, ShieldCheck, Cloud, Mail, Users,
  BarChart3, Workflow, Plug, Settings, type LucideIcon,
} from "lucide-react";

export const NAV: { href: string; label: string; icon: LucideIcon; group: string }[] = [
  { href: "/overview", label: "Overview", icon: LayoutDashboard, group: "Pipeline" },
  { href: "/opportunities", label: "Find Opportunities", icon: Search, group: "Pipeline" },
  { href: "/leads", label: "Business Leads", icon: Building2, group: "Pipeline" },
  { href: "/audits", label: "Website Audits", icon: ClipboardCheck, group: "Pipeline" },
  { href: "/design-research", label: "Design Research", icon: Palette, group: "Build" },
  { href: "/builder", label: "AI Website Builder", icon: Wand2, group: "Build" },
  { href: "/approvals", label: "Prototype Approvals", icon: ShieldCheck, group: "Build" },
  { href: "/deployments", label: "Cloudflare Deployments", icon: Cloud, group: "Build" },
  { href: "/emails", label: "Email Campaigns", icon: Mail, group: "Outreach" },
  { href: "/crm", label: "CRM", icon: Users, group: "Outreach" },
  { href: "/analytics", label: "Analytics", icon: BarChart3, group: "Outreach" },
  { href: "/automation", label: "Automation Centre", icon: Workflow, group: "System" },
  { href: "/integrations", label: "Integrations", icon: Plug, group: "System" },
  { href: "/settings", label: "Settings", icon: Settings, group: "System" },
];
