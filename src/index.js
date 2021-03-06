/*jslint node: true */
'use strict'

const { assign, keys, getPrototypeOf } = Object
const { toString, hasOwnProperty } = Object.prototype
const { isArray } = Array
const arrayKeyRegEx = /^\[(\w+)\]$/

// https://github.com/sindresorhus/is-plain-obj
function isPOJO(x) {
  var prototype;
	return toString.call(x) === '[object Object]' && (prototype = getPrototypeOf(x), prototype === null || prototype === getPrototypeOf({}));
}

function isFunction(obj) {
  return typeof obj === 'function'
}

function isPrimitive(val) {
  return val == null || (typeof val !== 'function' && typeof val !== 'object')
}

function getPath(path) {
  if (typeof path === 'string') path = path.split('.')
  return (isArray(path) ? path : [path]).map(getPathType)
}

function getPathType(p){
  if(isArray(p)) return p
  const match = arrayKeyRegEx.exec(p)
  return match!=null ? ['array', match[1]] : ['', p]
}

function isWrapper(obj){
  return isFunction(obj) && isFunction(obj.map)
}

function isWrappedData(obj){
  return isWrapper(obj) && 'root' in obj && 'path' in obj && isFunction(obj.get)
}

function isPrimitive2(val) {
  return isPrimitive(val) || isWrapper(val)
}
const ignoreFirstCall = fn => {
  let calledOnce = false
  return function(arg) {
    return calledOnce ? fn.call(this, arg) : calledOnce = true
  }
}

function wrapData(wrapper) {

  return source => {
    let finished = 0
    let root
    let _callback = wrapper()
    let changeCount = 0
    let _cache = null
    let cb = (value, type) => finished && root!=null && !root.skip && ++changeCount>0 && _callback({value, type})

    root = createWrap(source, [])
    
    let oldMap = _callback.map
    _callback.map = function(fn) {
      const _fn = changeCount>0 ? ignoreFirstCall(fn) : fn
      return oldMap.call(this, _fn)
    }
    root.change = _callback

    function bindMethods(packer, path, type='change') {
      if('path' in packer && 'root' in packer) return packer
      // type: 0->CHANGE, 1->ADD, 2->DELETE
      packer.root = root
      packer.path = path
      packer.map(v => cb(packer, type))
      type = 'change'
      packer.get = get
      packer.got = got
      packer.set = set
      packer.getset = getset
      packer.ensure = ensure
      packer.unset = unset
      packer.unwrap = unwrap
      if(isArray(packer())){
        packer.push = push
        packer.pop = pop
      }
      return packer
    }

    function createWrap(source, prevPath = []) {
      let packer = wrapper()
      const isRoot = _cache == null
      if (isRoot) {
        _cache = [[source, packer, null]]
        root = packer
      }

      if (isPrimitive2(source)) {
        packer = bindMethods(wrapper(source), prevPath)
        return packer
      }
      
      const target = isArray(source) ? [] : isPOJO(source) ? {} : source
      packer(deepIt(target, source, (a, b, key, path) => {
        const _path = path.concat(key)
        const bval = b[key]
        if (bval === undefined) a[key] = wrapper()
        else if (isPrimitive2(bval)) a[key] = wrapper(bval)
        else {
          const prev = _cache.find(function (v) { return v[0] === bval })
          if (prev == null) {
            _cache.push([bval, a, key])
            a[key] = createWrap(bval, _path, _cache)
          } else {
            prev.push(() => {
              const [_, x, k] = prev
              a[key] = k == null ? x : x[k]
              bindMethods(a[key], k == null ? [] : _path)
            })
          }
        }
        if (a[key] != null) {
          bindMethods(a[key], _path)
        }
      }, prevPath))
      
      const ret = bindMethods(packer, prevPath)

      if (isRoot) {
        _cache.forEach(v => {
          if (isFunction(v[3])) {
            v[3]()
          }
        })
        finished = 1
      }
      return ret
    }


    function deepIt(a, b, callback, path) {
      _cache = isArray(_cache) ? _cache : []
      path = isArray(path) ? path : []
      if (isPrimitive2(b)) return bindMethods(wrapper(a), path)
      for (let key in b) {
        if (!hasOwnProperty.call(b, key)) continue
        // return false stop the iteration
        const ret = callback(a, b, key, path, _cache)
        if (ret === false) break
        else if (ret === 0) continue
        const aval = a[key]
        const bval = b[key]
        if (!isPrimitive2(bval) && isFunction(aval) && !isPrimitive(aval())) {
          const prev = _cache.find(function (v) { return v[0] === bval })
          if (prev == null) {
            const _path = path.concat(key)
            _cache.push([bval, a, key])
            deepIt(aval(), bval, callback, _path)
          } else {
            // recursive found
          }
        }
      }
      return a
    }

    function get(path) {
      let obj = this
      let n = obj
      path = getPath(path)
      for (let i = 0, len = path.length; i < len; i++) {
        if (!isWrapper(n)) {
          return
        }
        n = n()[path[i][1]]
      }
      return n
    }

    function got (path) {
      const stream = this.get(path)
      return assign({stream},  stream != null && {value: isWrapper(stream) ? stream.unwrap() : stream})
    }

    // ensure path exists
    function ensure(path, defaultValue, descriptor) {
      let obj = this
      let val = obj.get(path)
      if (val == null) {
        val = obj.set(path, defaultValue, descriptor)
      }
      return val
    }
    
    function set(path, value, descriptor) {
      if(arguments.length<=1) {
        value = path
        path = []
      }
      const func = ()=>value
      return getset.call(this, path, func, descriptor)
    }

    function getset(path, func, descriptor) {
      let obj = this
      if(arguments.length<=1 && isFunction(path)) {
        func = path
        path = []
      }
      
      path = getPath(path)
      if (!isWrapper(obj)) return obj

      let value, action
      let i, len, t, nextT, p, n = obj()
      finished = 0
      
      if(!path.length){
        obj(createWrap(func(obj.unwrap()), obj.path.slice())())
        value = obj
        action = 'change'
      } else {
        const _path = path.map(v=>v[1])
        for (i = 0, len = path.length - 1; i < len; i++) {
          ;[t, p] = path[i]
          ;[nextT] = path[i+1]
          if (!isWrapper(n[p])) {
            n[p] = bindMethods(wrapper(nextT==='array' ? [] : {}), _path.slice(0, i + 1))
          }
          n = n[p]()
        }
        ;[t, p] = path[i]
        if(isWrapper(n[p])){
          n[p](createWrap(func(n[p].unwrap()), obj.path.concat(_path))())
          value = n[p]
          action = 'change'
        } else {
          value = createWrap(func(n[p], true), obj.path.concat(_path))
          if(isPrimitive(descriptor)) {
            n[p] = value
          }else{
            Object.defineProperty(n, p, assign({value}, descriptor))
          }
          action = 'add'
        }
      }
      finished = 1
      cb(value, action)

      return value
    }

    function unset(path) {
      let obj = this

      path = getPath(path)
      let len = path.length
      if (!isWrapper(obj) || !len) return
      let val = obj.get(path.slice(0, -1))
      if (val == null) return
      let parent = val()
      let [t, p] = path[len - 1]
      if(!(p in parent)) return
      let deleteVal = parent[p]
      delete parent[p]
      cb(deleteVal, 'delete')
      return isWrapper(deleteVal) ? deleteVal.unwrap() : deleteVal
    }

    function push(value) {
      let len = this().length
      return this.set(len, value)
    }

    function pop() {
      let len = this().length
      let val = this.unset(len-1)
      this().pop()
      return val
    }

    function unwrap(path, config={}) {
      if(arguments.length===1 && isPOJO(path)) {
        config = path
        path = null
      }
      return _unwrap(path!=null ? this.get(path) : this, config)
    }

    return root
  }
}


function _checkCacheAndUnwrap(config, _cache, val, result, key) {
  const prev = _cache.find(v=>v[0]===val)
  if(prev != null) {
    !config.json && prev.push(()=>{
      const [_, r, k] = prev
      result[key] = k==null ? r : r[k]
    })
  } else {
    _cache.push([val, result, key])
    result[key] = _unwrap(val, config, _cache)
  }
  return prev
}

function _unwrap(obj, config, _cache) {
  let isRoot = _cache==null
  if(isRoot) _cache = [[obj]]
  
  let result
  let source = obj
  if (isArray(source)){
    result = []
    source.forEach((val,key)=> {
      _checkCacheAndUnwrap(config, _cache, val, result, key)
    })
  } else if(isPOJO(source)){
    result = {}
    keys(source).forEach(key => {
      const val = source[key]
      _checkCacheAndUnwrap(config, _cache, val, result, key)
    })
  } else if(isWrappedData(source)) {
    result = _unwrap(source(), config, _cache)
  } else {
    while (isWrapper(source)) {
      source = source()
    }
    result = source
  }
  if (isRoot) {
    _cache.forEach(v => {
      if (isFunction(v[3])) {
        v[3]()
      }
    })
  }
  return result
}

module.exports = wrapData

