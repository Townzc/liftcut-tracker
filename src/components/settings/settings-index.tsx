"use client";
import Link from "next/link";
import {useLocale} from "next-intl";
import {ChevronRight,Dumbbell,SlidersHorizontal,Download,Volleyball,UserRound} from "lucide-react";
import {useAuth} from "@/components/auth/auth-provider";
import {UserAvatar} from "@/components/shared/user-avatar";

export function SettingsIndex(){
  const en=useLocale()==="en",{profile,user,authMode}=useAuth();
  const name=authMode==="guest"?(en?"Guest":"访客"):profile?.displayName||user?.email?.split("@")[0]||"LiftCut";
  const groups=[[
    {href:"profile",icon:Dumbbell,title:en?"Training & nutrition":"训练与饮食偏好",description:en?"Your goals, equipment and preferences":"目标、器械与个人偏好"},
    {href:"preferences",icon:SlidersHorizontal,title:en?"Appearance & language":"外观与语言",description:en?"Make it feel like yours":"主题与语言设置"},
  ],[
    {href:"data",icon:Download,title:en?"Your data":"数据管理",description:en?"Export your records":"导出与管理记录"},
    {href:"about",icon:Volleyball,title:en?"About LiftCut":"关于 LiftCut",description:en?"A little help getting started":"了解功能与使用方式"},
  ]];
  return <div className="mx-auto max-w-2xl space-y-6 pt-7" data-testid="settings-index">
    <h1 className="mb-8 text-3xl font-medium tracking-tight">{en?"Settings":"设置"}<span className="text-muted-foreground">.</span></h1>
    <Link href="/settings/account" prefetch className="flex min-h-28 items-center gap-4 rounded-[28px] bg-muted/45 px-5 py-6 transition-colors hover:bg-muted">
      <UserAvatar displayName={name} email={user?.email} avatarUrl={profile?.avatarUrl} className="size-14 bg-background text-foreground" />
      <div className="min-w-0 flex-1"><p className="truncate text-lg font-medium">{name}</p><p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground"><UserRound className="size-3"/>{en?"Account & profile":"账号与个人资料"}</p></div><ChevronRight className="size-5 text-muted-foreground"/>
    </Link>
    {groups.map((group,i)=><div key={i} className="overflow-hidden rounded-[28px] bg-muted/35 px-5">{group.map(({href,icon:Icon,title,description},j)=><Link key={href} href={`/settings/${href}`} prefetch className={`flex min-h-24 items-center gap-4 py-5 transition-colors hover:text-muted-foreground ${j?"border-t border-border/60":""}`}>
      <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-background"><Icon className="size-5" strokeWidth={1.6}/></span>
      <span className="min-w-0 flex-1"><span className="block text-sm font-medium sm:text-base">{title}</span><span className="mt-1 block text-xs text-muted-foreground">{description}</span></span><ChevronRight className="size-4 text-muted-foreground"/>
    </Link>)}</div>)}
    <p className="pt-3 text-center text-xs tracking-wide text-muted-foreground">liftcut. {en?"At your own pace.":"按自己的节奏来."}</p>
  </div>;
}
