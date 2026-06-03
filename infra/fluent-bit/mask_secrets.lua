-- mask_secrets.lua
-- Masque les données sensibles dans les logs avant envoi à Loki
-- Patterns couverts : password, mot de passe, secret, token, api_key,
--                     authorization, passwd, pwd, private_key, access_key

function mask_sensitive(tag, timestamp, record)

    local patterns = {
        -- Format JSON : "password":"valeur" ou "password" : "valeur"
        '"[Pp]assword"%s*:%s*"[^"]*"',
        '"[Mm]ot[_%-]?[Dd]e[_%-]?[Pp]asse"%s*:%s*"[^"]*"',
        '"[Ss]ecret"%s*:%s*"[^"]*"',
        '"[Tt]oken"%s*:%s*"[^"]*"',
        '"[Aa]pi[_%-]?[Kk]ey"%s*:%s*"[^"]*"',
        '"[Aa]uthorization"%s*:%s*"[^"]*"',
        '"[Pp]asswd"%s*:%s*"[^"]*"',
        '"[Pp]wd"%s*:%s*"[^"]*"',
        '"[Pp]rivate[_%-]?[Kk]ey"%s*:%s*"[^"]*"',
        '"[Aa]ccess[_%-]?[Kk]ey"%s*:%s*"[^"]*"',
        '"[Bb]earer"%s*:%s*"[^"]*"',
        -- Format texte : password=valeur ou password : valeur
        '[Pp]assword%s*[=:]+%s*%S+',
        '[Ss]ecret%s*[=:]+%s*%S+',
        '[Tt]oken%s*[=:]+%s*%S+',
        '[Aa]pi[_%-]?[Kk]ey%s*[=:]+%s*%S+',
        '[Pp]asswd%s*[=:]+%s*%S+',
        '[Pp]wd%s*[=:]+%s*%S+',
        -- Bearer token dans header Authorization
        'Bearer%s+[A-Za-z0-9%.%-_]+',
        -- Format URL : ?password=valeur&
        '[?&][Pp]assword=[^&%s]+',
        '[?&][Tt]oken=[^&%s]+',
        '[?&]_token=[^&%s]+',     -- CSRF token Laravel
    }

    -- Fonction helper pour masquer dans un champ donné
    local function mask_field(value)
        if value == nil then return value end
        local result = value
        for _, pattern in ipairs(patterns) do
            result = result:gsub(pattern, function(match)
                -- Garde le nom du champ, masque seulement la valeur
                local key_part = match:match('^(.-)%s*[=:]+%s*') or
                                 match:match('^(".-)"%s*:%s*')
                if key_part then
                    return key_part .. '=***MASKED***'
                end
                return '***MASKED***'
            end)
        end
        return result
    end

    -- Applique le masquage sur les champs texte du log
    if record["log"] ~= nil then
        record["log"] = mask_field(tostring(record["log"]))
    end
    if record["message"] ~= nil then
        record["message"] = mask_field(tostring(record["message"]))
    end
    if record["msg"] ~= nil then
        record["msg"] = mask_field(tostring(record["msg"]))
    end

    return 1, timestamp, record
end