import { useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import type { ModDefinition, ModSummary } from '../types'
import { GAME_VERSION, ROSTER_DATA_VERSION, WORLD_DATA_VERSION } from '../version'

const slugify = (value: string) => value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,64)

interface Props {
  mods: ModSummary[]
  activeModId: string
  busy: boolean
  error: string | null
  onClose: () => void
  onActivate: (id: string) => void
  onEdit: (id: string) => void
  onDelete: (id: string) => void
  onCreate: (metadata: Pick<ModDefinition,'id'|'name'|'description'|'author'|'version'|'bfmeVersion'>, sourceModId: string | null) => void
  onOpenFolder: () => void
  onMapChange: (id:string,file:File) => void
  onMapReset: (id:string) => void
}

export default function ModManager({ mods, activeModId, busy, error, onClose, onActivate, onEdit, onDelete, onCreate, onOpenFolder, onMapChange, onMapReset }: Props) {
  const [creating,setCreating]=useState(false)
  const [name,setName]=useState('')
  const [id,setId]=useState('')
  const [author,setAuthor]=useState('')
  const [description,setDescription]=useState('')
  const [version,setVersion]=useState('0.1.0')
  const [bfmeVersion,setBfmeVersion]=useState('BFME2')
  const [source,setSource]=useState<string>('default')
  const validId=/^[a-z0-9][a-z0-9-]{1,63}$/.test(id)&&!mods.some((mod)=>mod.id===id)
  const ordered=useMemo(()=>[...mods].sort((a,b)=>a.name.localeCompare(b.name,'ru')),[mods])
  const submit=()=>{if(!name.trim()||!validId)return;onCreate({id,name:name.trim(),description:description.trim(),author:author.trim()||'Не указан',version:version.trim()||'0.1.0',bfmeVersion:bfmeVersion.trim()},source==='empty'?null:source);setCreating(false);setName('');setId('')}
  return <main className="mod-manager-screen"><section className="mod-manager-card"><header><div><small>Контент отделён от движка · версия {GAME_VERSION}</small><h1>Управление модами</h1><p>Активный мод определяет карту, фракции, отряды, героев и отдельное сохранение кампании.</p></div><button type="button" onClick={onClose}>×</button></header>{error&&<div className="mod-manager-error">{error}</div>}<div className="mod-list">{ordered.map((mod)=>{const active=mod.id===activeModId;const dataCompatible=mod.dataVersions.world===WORLD_DATA_VERSION&&mod.dataVersions.roster===ROSTER_DATA_VERSION;const confirmOpen=()=>dataCompatible||window.confirm(`Мод «${mod.name}» использует другую версию данных. Открыть всё равно?`);return <article key={mod.id} className={active?'active':''} style={{'--mod-color':active?'#c8aa68':'#66757b'} as CSSProperties}><span className="mod-status-dot"/><div className="mod-copy"><small>{mod.id==='default'?'Встроенный мод':'Пользовательский мод'}</small><h2>{mod.name}<i>v{mod.version}</i></h2><p>{mod.description||'Описание не задано'}</p><div><span>Автор: {mod.author}</span><span>{mod.bfmeVersion||'BFME2'}</span><span>{mod.locationCount} объектов</span><span>{mod.heroCount} героев</span><span>{mod.factionCount} фракций</span><span>{mod.mapImage ? 'Своя глобальная карта' : 'Стандартная глобальная карта'}</span></div></div><aside><b>{!dataCompatible?'Устаревшие данные':active?'Активен':mod.hasCompatibleSave?'Есть сохранение':'Новая кампания'}</b>{!active&&<button type="button" disabled={busy} onClick={()=>{if(confirmOpen())onActivate(mod.id)}}>Активировать</button>}<button type="button" disabled={busy} onClick={()=>{if(confirmOpen())onEdit(mod.id)}}>Редактировать</button><label className="mod-map-upload">{mod.mapImage ? 'Заменить свою карту' : 'Установить свою карту'}<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event)=>{const file=event.target.files?.[0];if(file)onMapChange(mod.id,file);event.target.value='' }}/></label>{mod.mapImage&&<button type="button" disabled={busy} onClick={()=>{if(window.confirm(`Вернуть для мода «${mod.name}» стандартную глобальную карту?`))onMapReset(mod.id)}}>Вернуть стандартную</button>}{mod.id!=='default'&&<button type="button" className="danger" disabled={busy} onClick={()=>{if(window.confirm(`Удалить мод «${mod.name}» и его сохранения?`))onDelete(mod.id)}}>Удалить</button>}</aside></article>})}{!ordered.length&&<div className="empty-list">Моды не найдены</div>}</div><footer><button type="button" className="primary" onClick={()=>setCreating(true)}>＋ Создать новый мод</button><button type="button" disabled title="Импорт .wotr будет добавлен следующим этапом">Импортировать</button><button type="button" disabled title="Экспорт .wotr будет добавлен следующим этапом">Экспортировать</button><button type="button" onClick={onOpenFolder}>Открыть папку модов</button></footer></section>{creating&&<div className="mod-create-backdrop"><section className="mod-create-dialog"><header><h2>Новый мод</h2><button onClick={()=>setCreating(false)}>×</button></header><label><span>Название</span><input value={name} autoFocus onChange={(e)=>{setName(e.target.value);if(!id||id===slugify(name))setId(slugify(e.target.value))}}/></label><label><span>ID папки, латиницей</span><input value={id} onChange={(e)=>setId(slugify(e.target.value))}/><small className={validId?'valid':'invalid'}>{validId?'ID свободен':'Введите уникальный ID: a-z, 0-9 и дефис'}</small></label><div className="mod-create-row"><label><span>Автор</span><input value={author} onChange={(e)=>setAuthor(e.target.value)}/></label><label><span>Версия мода</span><input value={version} onChange={(e)=>setVersion(e.target.value)}/></label></div><label><span>Версия BFME</span><input value={bfmeVersion} onChange={(e)=>setBfmeVersion(e.target.value)}/></label><label><span>Основа</span><select value={source} onChange={(e)=>setSource(e.target.value)}><option value="empty">Пустой шаблон</option>{ordered.map((mod)=><option key={mod.id} value={mod.id}>Копия: {mod.name}</option>)}</select></label><label><span>Описание</span><textarea value={description} onChange={(e)=>setDescription(e.target.value)}/></label><footer><button onClick={()=>setCreating(false)}>Отмена</button><button className="primary" disabled={!validId||!name.trim()||busy} onClick={submit}>Создать и открыть редактор</button></footer></section></div>}</main>
}
