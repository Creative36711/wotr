import fs from 'node:fs/promises'
import path from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { GAME_VERSION, ROSTER_DATA_VERSION, SAVEGAME_DATA_VERSION, WORLD_DATA_VERSION } from './src/version.ts'

const PUBLIC_ROOT = path.resolve(process.cwd(), 'public')
const MODS_ROOT = path.join(PUBLIC_ROOT, 'mods')
const APP_FILE = path.join(PUBLIC_ROOT, 'app.json')
const TEMPLATES_ROOT = path.join(PUBLIC_ROOT, 'templates')
const DEFAULT_MAP_FILE = path.join(TEMPLATES_ROOT, 'map.jpg')
const MAX_BODY_SIZE = 32 * 1024 * 1024
const MAX_RTS_ASSET_SIZE = 1024 * 1024 * 1024
const MOD_ID = /^[a-z0-9][a-z0-9-]{1,63}$/

function validateWorld(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Ожидался объект данных мира')
  const world = value as Record<string, unknown>
  if (!Array.isArray(world.locations) || !world.grid || typeof world.grid !== 'object') throw new Error('world.json повреждён')
  for (const key of ['factions', 'armies', 'regions']) if (!Array.isArray(world[key])) throw new Error(`Отсутствует массив ${key}`)
}
function validateRoster(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Ожидался объект каталога')
  const roster = value as Record<string, unknown>
  if (roster.version !== ROSTER_DATA_VERSION || !Array.isArray(roster.unitTypes) || !Array.isArray(roster.heroes) || !Array.isArray(roster.captains)) throw new Error('roster.json повреждён или имеет другую версию')
}
function validateSaveGame(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Ожидался объект сохранения')
  const save = value as Record<string, unknown>
  if (save.version !== SAVEGAME_DATA_VERSION || save.gameVersion !== GAME_VERSION) throw new Error(`Сохранение не соответствует версии игры ${GAME_VERSION}`)
  if (!Array.isArray(save.armies) || !save.campaign) throw new Error('Сохранение повреждено')
}
function validateMod(value: unknown) {
  const mod = value as Record<string, unknown>
  if (!mod || typeof mod !== 'object' || !MOD_ID.test(String(mod.id ?? '')) || !String(mod.name ?? '').trim()) throw new Error('mod.json повреждён')
}
function validateApp(value: unknown) {
  const app = value as Record<string, unknown>
  if (!app || typeof app !== 'object' || !MOD_ID.test(String(app.activeModId ?? ''))) throw new Error('app.json повреждён')
}
const validators = { world: validateWorld, roster: validateRoster, savegame: validateSaveGame, mod: validateMod }

async function readBody(req: AsyncIterable<unknown>, maximumSize = MAX_BODY_SIZE) {
  const chunks: Buffer[] = []; let size = 0
  for await (const raw of req) { const chunk = Buffer.from(raw as any); size += chunk.length; if (size > maximumSize) throw new Error('Файл слишком большой'); chunks.push(chunk) }
  return Buffer.concat(chunks)
}
function modPath(modId: string) {
  if (!MOD_ID.test(modId)) throw new Error('Недопустимый ID мода')
  return path.join(MODS_ROOT, modId)
}
const ASSET_ID=/^[a-zA-Z0-9_-]{1,100}$/
const BIG_NAME=/^[^<>:"/\\|?*\x00-\x1f]+\.big$/i
function rtsAssetPath(modId:string,scope:string,entityId:string){
  if(!ASSET_ID.test(entityId))throw new Error('Недопустимый ID RTS-ресурса')
  const root=path.join(modPath(modId),'rts')
  if(scope==='module')return path.join(root,'modules',`${entityId}.big`)
  if(scope==='maps')return path.join(root,'maps','maps.big')
  if(scope==='location-cache')return path.join(root,'map-caches','locations',`${entityId}.big`)
  if(scope==='region-cache')return path.join(root,'map-caches','regions',`${entityId}.big`)
  throw new Error('Неизвестная категория RTS-ресурса')
}
function parseMapCacheBuffer(data:Buffer){
  const text=data.toString('latin1');const match=text.match(/MapCache\s+([^\r\n]+)/i);if(!match)throw new Error('В BIG-файле не найден блок MapCache')
  const cacheKey=match[1].trim();const mapPath=cacheKey.replace(/_([0-9a-f]{2})/gi,(_m,hex)=>String.fromCharCode(parseInt(hex,16)));const mapName=(mapPath.split(/[\\/]/).pop()??mapPath).replace(/\.map$/i,'');const numPlayers=Math.max(0,Number(text.match(/\bnumPlayers\s*=\s*(-?\d+)/i)?.[1]??0));const playerStarts=[...text.matchAll(/Player_(\d+)_Start\s*=\s*X:([-\d.]+)\s+Y:([-\d.]+)\s+Z:([-\d.]+)/gi)].map((item)=>({slot:Number(item[1]),x:Number(item[2]),y:Number(item[3]),z:Number(item[4])}));return{cacheKey,mapPath,mapName,numPlayers,playerStarts}
}
function fileFor(modId: string, kind: keyof typeof validators) {
  const root = modPath(modId)
  return kind === 'savegame' ? path.join(root, 'saves', 'autosave.json') : path.join(root, kind === 'mod' ? 'mod.json' : `${kind}.json`)
}
async function atomicWriteBinary(file:string,data:Buffer){await fs.mkdir(path.dirname(file),{recursive:true});const temp=`${file}.tmp`;await fs.writeFile(temp,data);await fs.rename(temp,file)}
async function writeJson(file: string, value: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true }); const temp = `${file}.tmp`; await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8'); await fs.rename(temp, file)
}
async function listMods() {
  await fs.mkdir(MODS_ROOT, { recursive: true })
  const entries = await fs.readdir(MODS_ROOT, { withFileTypes: true })
  const result: any[] = []
  for (const entry of entries.filter((item) => item.isDirectory())) {
    try {
      const root = modPath(entry.name)
      const metadata = JSON.parse(await fs.readFile(path.join(root, 'mod.json'), 'utf8'))
      const world = JSON.parse(await fs.readFile(path.join(root, 'world.json'), 'utf8'))
      const roster = JSON.parse(await fs.readFile(path.join(root, 'roster.json'), 'utf8'))
      let hasCompatibleSave = false
      try { const save = JSON.parse(await fs.readFile(path.join(root, 'saves', 'autosave.json'), 'utf8')); hasCompatibleSave = save.version === SAVEGAME_DATA_VERSION && save.gameVersion === GAME_VERSION && save.modId === entry.name } catch {}
      result.push({ ...metadata, locationCount: world.locations?.length ?? 0, heroCount: roster.heroes?.length ?? 0, factionCount: world.factions?.filter((f: any) => f.playable)?.length ?? 0, hasCompatibleSave })
    } catch (error) { console.warn(`Broken mod ${entry.name}:`, error) }
  }
  return result.sort((a, b) => String(a.name).localeCompare(String(b.name), 'ru'))
}

function modsApi(): Plugin {
  return { name: 'wotr-mod-files-api', configureServer(server) {
    server.middlewares.use('/api/app-settings', async (req, res) => {
      res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store')
      try {
        if (req.method === 'GET') { res.end(await fs.readFile(APP_FILE, 'utf8')); return }
        if (req.method === 'PUT') { const value = JSON.parse((await readBody(req)).toString('utf8')); validateApp(value); await writeJson(APP_FILE, value); res.end(JSON.stringify({ ok: true })); return }
        res.statusCode = 405; res.end(JSON.stringify({ error: 'Метод не поддерживается' }))
      } catch (error) { res.statusCode = 400; res.end(JSON.stringify({ error: String(error) })) }
    })
    server.middlewares.use('/api/mods', async (req, res) => {
      res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store')
      try {
        if (req.method === 'GET') { res.end(JSON.stringify(await listMods())); return }
        if (req.method !== 'POST') { res.statusCode = 405; res.end(JSON.stringify({ error: 'Метод не поддерживается' })); return }
        const body = JSON.parse((await readBody(req)).toString('utf8'))
        if (body.action === 'delete') { if (body.modId === 'default') throw new Error('Встроенный мод удалить нельзя'); await fs.rm(modPath(body.modId), { recursive: true, force: true }); res.end(JSON.stringify({ ok: true })); return }
        if (body.action === 'create') {
          const metadata = body.metadata; validateMod(metadata); const destination = modPath(metadata.id)
          try { await fs.access(destination); throw new Error('Мод с таким ID уже существует') } catch (error: any) { if (!String(error?.message).includes('ENOENT')) throw error }
          await fs.mkdir(destination, { recursive: true })
          let mapImage: string | null = null
          let sourceRts: any = null
          let sourceLocales: string[] | null = null
          let sourceDefaultLocale: string | null = null
          if (body.sourceModId) {
            const source = modPath(body.sourceModId)
            await Promise.all(['world.json','roster.json'].map((file) => fs.copyFile(path.join(source,file), path.join(destination,file))))
            const sourceMeta = JSON.parse(await fs.readFile(path.join(source,'mod.json'),'utf8'))
            sourceRts = sourceMeta.rts ?? null
            sourceLocales = Array.isArray(sourceMeta.supportedLocales) ? sourceMeta.supportedLocales : null
            sourceDefaultLocale = typeof sourceMeta.defaultLocale === 'string' ? sourceMeta.defaultLocale : null
            const sourceMap = typeof sourceMeta.mapImage === 'string' && /^map\.(jpg|png|webp)$/i.test(sourceMeta.mapImage) ? sourceMeta.mapImage : null
            if (sourceMap) {
              mapImage = `map${path.extname(sourceMap).toLowerCase()}`
              await fs.copyFile(path.join(source, sourceMap), path.join(destination, mapImage))
            }
            try { await fs.cp(path.join(source,'rts'),path.join(destination,'rts'),{recursive:true}) } catch {}
          } else {
            await fs.copyFile(path.join(TEMPLATES_ROOT,'world_template.json'), path.join(destination,'world.json'))
            await fs.copyFile(path.join(TEMPLATES_ROOT,'roster_template.json'), path.join(destination,'roster.json'))
          }
          const now = new Date().toISOString(); const supportedLocales = [...new Set(['en', ...(sourceLocales ?? ['ru'])])]; const mod = { ...metadata, createdAt: now, updatedAt: now, supportedLocales, defaultLocale: sourceDefaultLocale && supportedLocales.includes(sourceDefaultLocale) ? sourceDefaultLocale : supportedLocales.includes('ru') ? 'ru' : 'en', mapImage, rts: sourceRts ?? { enabled: true, factionOrder: [], moduleFiles: [], mapsFile: null, mapCacheTargetFileName: '__wotr_maps_cache.big', networkRules: '0 0 0 200 4000 -1 -1 -1 -1 -1' }, dataVersions: { world: WORLD_DATA_VERSION, roster: ROSTER_DATA_VERSION } }; await writeJson(path.join(destination,'mod.json'), mod)
          res.end(JSON.stringify({ ok: true, mod })); return
        }
        if (body.action === 'folder') { res.end(JSON.stringify({ path: MODS_ROOT })); return }
        throw new Error('Неизвестное действие')
      } catch (error) { res.statusCode = 400; res.end(JSON.stringify({ error: String(error) })) }
    })
    server.middlewares.use('/api/mod-file', async (req, res) => {
      res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store')
      try {
        const url = new URL(req.url ?? '', 'http://localhost'); const modId = url.searchParams.get('modId') ?? ''; const kind = url.searchParams.get('kind') as keyof typeof validators
        if (!validators[kind]) throw new Error('Неизвестный файл мода'); const file = fileFor(modId, kind)
        if (req.method === 'GET') { res.end(await fs.readFile(file, 'utf8')); return }
        if (req.method === 'PUT') { const value = JSON.parse((await readBody(req)).toString('utf8')); validators[kind](value); await writeJson(file, value); res.end(JSON.stringify({ ok: true })); return }
        res.statusCode = 405; res.end(JSON.stringify({ error: 'Метод не поддерживается' }))
      } catch (error) { res.statusCode = 400; res.end(JSON.stringify({ error: String(error) })) }
    })
    server.middlewares.use('/api/rts-map-caches', async (req,res)=>{
      res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store')
      try{const url=new URL(req.url??'','http://localhost');const modId=url.searchParams.get('modId')??'';const root=modPath(modId);const result:any[]=[];for(const [scope,folder] of [['location-cache','rts/map-caches/locations']] as const){const directory=path.join(root,folder);let names:string[]=[];try{names=await fs.readdir(directory)}catch{}for(const name of names.filter((value)=>value.toLowerCase().endsWith('.big'))){const entityId=path.basename(name,'.big');if(!ASSET_ID.test(entityId))continue;const file=path.join(directory,name);const data=await fs.readFile(file);result.push({scope,entityId,id:entityId,assetId:entityId,originalFileName:name,storageName:path.relative(root,file).split(path.sep).join('/'),size:data.length,...parseMapCacheBuffer(data)})}}res.end(JSON.stringify(result))}catch(error){res.statusCode=400;res.end(JSON.stringify({error:String(error)}))}
    })
    server.middlewares.use('/api/rts-asset', async (req,res)=>{
      res.setHeader('Cache-Control','no-store')
      try{
        const url=new URL(req.url??'','http://localhost');const modId=url.searchParams.get('modId')??'';const scope=url.searchParams.get('scope')??'';const entityId=url.searchParams.get('entityId')??'';const file=rtsAssetPath(modId,scope,entityId)
        if(req.method==='DELETE'){await fs.rm(file,{force:true});res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true}));return}
        if(req.method!=='PUT'){res.statusCode=405;res.end('Метод не поддерживается');return}
        const originalFileName=url.searchParams.get('fileName')??'asset.big';const targetRequested=url.searchParams.get('targetFileName')||originalFileName;if(!BIG_NAME.test(originalFileName)||!BIG_NAME.test(targetRequested))throw new Error('Разрешены только безопасные имена файлов .big')
        const data=await readBody(req,MAX_RTS_ASSET_SIZE);await atomicWriteBinary(file,data);const storageName=path.relative(modPath(modId),file).split(path.sep).join('/');const result:any={id:entityId,originalFileName,targetFileName:targetRequested,storageName,size:data.length};if(scope.endsWith('-cache'))Object.assign(result,parseMapCacheBuffer(data));res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result))
      }catch(error){res.statusCode=400;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:String(error)}))}
    })
    server.middlewares.use('/api/mod-map', async (req, res) => {
      try {
        const url = new URL(req.url ?? '', 'http://localhost')
        const modId = url.searchParams.get('modId') ?? ''
        const root = modPath(modId)
        const metaFile = path.join(root, 'mod.json')
        const meta = JSON.parse(await fs.readFile(metaFile, 'utf8'))
        const currentName = typeof meta.mapImage === 'string' && /^map\.(jpg|png|webp)$/i.test(meta.mapImage) ? meta.mapImage : null
        if (req.method === 'PUT') {
          const type = String(req.headers['content-type'] ?? 'image/jpeg')
          const extension = type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : 'jpg'
          const name = `map.${extension}`
          const data = await readBody(req)
          await atomicWriteBinary(path.join(root, name), data)
          if (currentName && currentName !== name) await fs.rm(path.join(root, currentName), { force: true })
          meta.mapImage = name
          meta.updatedAt = new Date().toISOString()
          await writeJson(metaFile, meta)
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ ok: true, mapImage: name }))
          return
        }
        if (req.method === 'DELETE') {
          if (currentName) await fs.rm(path.join(root, currentName), { force: true })
          meta.mapImage = null
          meta.updatedAt = new Date().toISOString()
          await writeJson(metaFile, meta)
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ ok: true, mapImage: null }))
          return
        }
        if (req.method !== 'GET') { res.statusCode = 405; res.end('Метод не поддерживается'); return }
        const selectedFile = currentName ? path.join(root, currentName) : DEFAULT_MAP_FILE
        const data = await fs.readFile(selectedFile)
        const extension = path.extname(selectedFile).toLowerCase()
        res.setHeader('Content-Type', extension === '.png' ? 'image/png' : extension === '.webp' ? 'image/webp' : 'image/jpeg')
        res.setHeader('Cache-Control', 'no-store')
        res.end(data)
      } catch (error) { res.statusCode = 404; res.end(String(error)) }
    })
  }}
}

export default defineConfig({ plugins: [react(), modsApi()], server: { host: '0.0.0.0', port: 5173, allowedHosts: true } })
